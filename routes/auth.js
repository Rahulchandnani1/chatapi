const { OAuth2Client } = require("google-auth-library");
const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Message = require("../models/Message");
const mongoose = require("mongoose");
const multer = require("multer");
const path = require("path");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const { Server } = require("socket.io");
const fs = require("fs");
const http = require("http");
const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const uploadsDir = path.join(__dirname, "uploads/");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}
function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir); // Absolute path for uploads directory
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

// Multer configuration with file type and size validation
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/gif"];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error("Only images are allowed"));
    }
    cb(null, true);
  },
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB file size limit
});

const onlineUsers = new Map();
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: "/api/auth/google/callback",
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await User.findOne({ googleId: profile.id });

        if (!user) {
          // Register a new user if not found
          user = await User.create({
            username: profile.displayName,
            email: profile.emails[0].value,
            googleId: profile.id,
            about: "Hey! there.",
            status: "offline",
          });
        }

        done(null, user);
      } catch (error) {
        done(error, null);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  // Register user online
  socket.on("userOnline", async (userId) => {
    onlineUsers.set(userId, socket.id);
    const user = await User.findById(userId);
    if (user) {
      user.status = "online";
      await user.save();
      io.emit("updateUserStatus", { userId, status: "online" });
    }
  });

  // Handle user sending messages
  socket.on("sendMessage", async ({ senderId, receiverId, message }) => {
    console.log(`Message from ${senderId} to ${receiverId}: ${message}`);

    const receiverSocketId = onlineUsers.get(receiverId);

    // Emit message to the sender
    socket.emit("message", { senderId, message });

    // Emit message to the receiver if online
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("message", { senderId, message });
    }
  });

  // Handle user going offline
  socket.on("disconnect", async () => {
    console.log("User disconnected:", socket.id);

    const userId = [...onlineUsers.entries()].find(
      ([, socketId]) => socketId === socket.id
    )?.[0];

    if (userId) {
      const user = await User.findById(userId);
      if (user) {
        user.status = "offline";
        await user.save();
        onlineUsers.delete(userId);
        io.emit("updateUserStatus", { userId, status: "offline" });
      }
    }
  });
});
router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

// Google Callback Route
router.get(
  "/google/callback",
  passport.authenticate("google", { failureRedirect: "/login" }),
  (req, res) => {
    // Generate JWT token
    const token = jwt.sign({ id: req.user._id }, JWT_SECRET, {
      expiresIn: "1h",
    });

    // Redirect or respond with token
    res.redirect(`/success?token=${token}`);
  }
);
// Register
router.post("/register", async (req, res) => {
  const { username, email, phone, password } = req.body;

  // Ensure at least email or phone is provided
  if (!username || (!email && !phone) || !password) {
    return res.status(400).json({ error: "Username, email/phone, and password are required." });
  }

  try {
    // Check for existing user with the same email or phone
    const existingUser = await User.findOne({
      $or: [{ email }, { phone }],
    });

    if (existingUser) {
      return res.status(400).json({
        error: email
          ? "Email is already registered."
          : "Phone number is already registered.",
      });
    }

    // Create the user
    const user = await User.create({
      username,
      email: email || null, // Set email to null if not provided
      phone: phone || null, // Set phone to null if not provided
      password,
      about: "Hey! there.",
      status: "offline",
    });

    res.status(201).json({ message: "User registered successfully", user });
  } catch (error) {
    console.error("Error registering user:", error);
    res.status(500).json({ error: "User registration failed" });
  }
});


// Login
router.post("/login", async (req, res) => {
  const { identifier, password } = req.body;

  try {
    const user = await User.findOne({
      $or: [{ email: identifier }, { phone: identifier }],
    });

    if (!user) {
      return res.status(401).json({
        error: "Invalid credentials",
      });
    }

    // User doesn't have a password
    if (!user.password) {
      return res.status(401).json({
        error: "This account does not have a password. Please register again.",
      });
    }

    const isMatch = await user.comparePassword(password);

    if (!isMatch) {
      return res.status(401).json({
        error: "Invalid credentials",
      });
    }

    const token = jwt.sign(
      { id: user._id },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.json({
      token,
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        phone: user.phone,
      },
    });

  } catch (error) {
    console.error("Error during login:", error);

    res.status(500).json({
      error: "Login failed",
    });
  }
});
router.post("/google-login", async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: "Token is required" });
  }

  try {
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const { name, email, sub: googleId } = ticket.getPayload();

    let user = await User.findOne({ googleId });
    if (!user) {
      user = await User.create({
        username: name,
        email,
        googleId,
        about: "Hey! there.",
        status: "offline",
      });
    }

    const jwtToken = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "1h" });
    res.json({ token: jwtToken });
  } catch (error) {
    console.error("Google Login Error:", error);
    res.status(500).json({ error: "Google login failed" });
  }
});

router.post('/google', async (req, res) => {
  const { name, email, image } = req.body;

  // Check if the user exists
  let user = await User.findOne({ email });

  if (!user) {
    // Register the user
    user = await User.create({
      name,
      email,
      password: null, // No password for Google login
      avatar: image,
    });
  }

  // Generate a token or session
  const token = generateToken(user._id);

  res.status(200).json({ token, user });
});
// Change Username
// Update username
router.get("/users", async (req, res) => {
  try {
    const users = await User.find().select("-password"); // Exclude passwords
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

router.get("/users/:userId/chats", async (req, res) => {
  const { userId } = req.params;

  // Validate userId
  if (!isValidObjectId(userId)) {
    return res.status(400).json({ error: "Invalid userId format" });
  }

  try {
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Find distinct chat partners
    const participants = await Message.aggregate([
      {
        $match: {
          $or: [{ sender: userObjectId }, { recipient: userObjectId }],
        },
      },
      {
        $project: {
          chatPartner: {
            $cond: {
              if: { $eq: ["$sender", userObjectId] },
              then: "$recipient",
              else: "$sender",
            },
          },
        },
      },
      {
        $group: {
          _id: "$chatPartner",
        },
      },
    ]);

    // Convert participant IDs to ObjectIds for population
    const participantIds = participants.map((p) => p._id);

    // Fetch user details for these participants
    const userDetails = await User.find({ _id: { $in: participantIds } });

    res.status(200).json(userDetails);
  } catch (error) {
    console.error("Error fetching chat participants:", error);
    res.status(500).json({ error: "Failed to fetch chat participants" });
  }
});
router.post("/block", async (req, res) => {
  const { userId, blockUserId } = req.body;

  if (!userId || !blockUserId) {
    return res.status(400).json({ error: "Both user IDs are required" });
  }

  try {
    const user = await User.findByIdAndUpdate(
      userId,
      { $addToSet: { blockedUsers: blockUserId } }, // Prevent duplicates
      { new: true }
    ).populate("blockedUsers");

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.status(200).json({
      message: "User blocked successfully",
      blockedUsers: user.blockedUsers,
    });
  } catch (error) {
    console.error("Error blocking user:", error);
    res.status(500).json({ error: "Failed to block user" });
  }
});

router.post("/unblock", async (req, res) => {
  const { userId, unblockUserId } = req.body;

  if (!userId || !unblockUserId) {
    return res.status(400).json({ error: "Both user IDs are required" });
  }

  try {
    const user = await User.findByIdAndUpdate(
      userId,
      { $pull: { blockedUsers: unblockUserId } }, // Remove the blocked user
      { new: true }
    ).populate("blockedUsers");

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.status(200).json({
      message: "User unblocked successfully",
      blockedUsers: user.blockedUsers,
    });
  } catch (error) {
    console.error("Error unblocking user:", error);
    res.status(500).json({ error: "Failed to unblock user" });
  }
});

router.post("/check-block-status", async (req, res) => {
  const { userId, targetUserId } = req.body;

  if (!userId || !targetUserId) {
    return res.status(400).json({ error: "Both user IDs are required." });
  }

  try {
    // Fetch the user who might have blocked the target user
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    // Check if the target user is in the blockedUsers list
    const isBlocked = user.blockedUsers.includes(targetUserId);

    res.status(200).json({ isBlocked });
  } catch (error) {
    console.error("Error checking block status:", error);
    res.status(500).json({ error: "Failed to check block status." });
  }
});


router.put("/change-username", async (req, res) => {
  const { email, newUsername } = req.body;

  if (!email || !newUsername) {
    return res.status(400).json({ error: "Email and new username are required." });
  }

  try {
    const user = await User.findOneAndUpdate(
      { email },
      { username: newUsername },
      { new: true } // Return the updated document
    );

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    res.json({ message: "Username updated successfully.", user });
  } catch (error) {
    res.status(500).json({ error: "Failed to update username." });
  }
});

router.put("/change-about", async (req, res) => {
  const { email, newabout } = req.body;

  if (!email || !newabout) {
    return res.status(400).json({ error: "Email and new about are required." });
  }

  try {
    const user = await User.findOneAndUpdate(
      { email },
      { about: newabout},
      { new: true } // Return the updated document
    );

    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    res.json({ message: "About updated successfully.", user });
  } catch (error) {
    res.status(500).json({ error: "Failed to update about." });
  }
});
router.put("/update-image", upload.single("image"), async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    user.image = `/uploads/${req.file.filename}`;
    await user.save();

    res.json({ message: "User image updated successfully", image: user.image });
  } catch (error) {
    console.error("Error updating user image:", error);
    res.status(500).json({ error: "Failed to update user image" });
  }
});

// Logout (handled client-side by clearing token)
router.post("/logout", (req, res) => {
  res.json({ message: "Logout successful" });
});

const authenticateToken = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ error: "Token missing or invalid" });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: "Invalid token" });
    }
    req.user = decoded; // Attach decoded user data to the request
    next();
  });
};

// Get User Details
router.get("/me", authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password"); // Exclude password
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch user details" });
  }
});
module.exports = router;
