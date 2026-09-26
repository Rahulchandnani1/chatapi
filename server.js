const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require('path');
const session = require("express-session");
const passport = require("passport");

dotenv.config();
const app = express();
app.use(
  session({
    secret: "your-session-secret",
    resave: false,
    saveUninitialized: true,
  })
);

app.use(passport.initialize());
app.use(passport.session());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(cors());
app.use(bodyParser.json());

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.log(err));

// Routes
const authRoutes = require("./routes/auth");
app.use("/api/auth", authRoutes);
const receipeRoutes = require("./routes/receipe");
app.use("/api/receipe", receipeRoutes);
const messageRoutes = require("./routes/message");
app.use("/api/chat", messageRoutes);
const groupRoutes = require("./routes/group");
app.use("/api/group", groupRoutes);
const contactusRoutes = require("./routes/contactus");
app.use("/api/contactus", contactusRoutes);
const openaiRoutes = require("./routes/openai");
app.use("/api/openai", openaiRoutes);
const receipechallengeRoutes = require("./routes/receipechallenge");
app.use("/api/challenges", receipechallengeRoutes);
const receipesubmitRoutes = require("./routes/receipesubmit");
app.use("/api/receipesubmit", receipesubmitRoutes);
const friendRoutes=require("./routes/friendRoutes");
app.use("/api/friends", friendRoutes);

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
