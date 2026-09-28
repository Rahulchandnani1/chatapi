const express = require("express");
const Message = require("../models/Message");
const User = require("../models/User");
const Group = require("../models/Group"); 
const multer = require('multer');
const path = require('path');
const router = express.Router();


const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // Directory to save files
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // Limit: 25 MB
});


const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/audio"); // Directory to save audio files
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const audioUpload = multer({
  storage: audioStorage,
  limits: { fileSize: 25 * 1024 * 1024 }, // Limit: 25 MB
});

// Endpoint to upload and send audio messages
router.post("/send-audio-message", audioUpload.single("audio"), async (req, res) => {
  const { senderId, recipientId, groupId, content } = req.body;

  if (!senderId || (!recipientId && !groupId) || (!req.file && !content)) {
    return res.status(400).json({ error: "Sender, recipient/group, and audio or content are required." });
  }

  try {
    const audioMessage = new Message({
      sender: senderId,
      recipient: recipientId || null,
      group: groupId || null,
      content: content || "",
      audioUrl: req.file ? `uploads/audio/${req.file.filename}` : null,
      file: req.file ? req.file.filename : null,
      fileType: req.file ? req.file.mimetype : null,
      timestamp: Date.now(),
    });

    await audioMessage.save();

    res.status(201).json({ message: "Audio message sent successfully", data: audioMessage });
  } catch (error) {
    console.error("Error sending audio message:", error);
    res.status(500).json({ error: "Failed to send audio message" });
  }
});
// Endpoint to handle file uploads
router.post('/upload-message', upload.single('file'), async (req, res) => {
  const { senderId, recipientId, content } = req.body;
  console.log('Uploaded file:', req.file); 
  if (!senderId || !recipientId || (!content && !req.file)) {
    return res.status(400).json({ error: "Sender, recipient, and either text or file are required." });
  }

  try {
    const message = new Message({
      sender: senderId,
      recipient: recipientId,
      content: content || null,
      file: req.file ? req.file.filename : null,
      fileType: req.file ? req.file.mimetype : null,
    });

    await message.save();
    res.status(200).json({ message: "Message sent successfully", data: message });
  } catch (error) {
    console.error("Error while saving message:", error);
    res.status(500).json({ error: "Failed to send message" });
  }
});

router.patch('/react-to-message/:id', async (req, res) => {
  const { id } = req.params; // Message ID
  const { userId, reaction } = req.body; // User's reaction details

  if (!userId || !reaction) {
    return res.status(400).json({ error: "UserId and reaction are required." });
  }

  try {
    const message = await Message.findById(id);

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    // Check if the user already reacted
    const existingReaction = message.reactions.find((r) => r.userId.toString() === userId);

    if (existingReaction) {
      // Update the existing reaction
      existingReaction.reaction = reaction;
    } else {
      // Add a new reaction
      message.reactions.push({ userId, reaction });
    }

    await message.save();

    res.status(200).json({ message: "Reaction updated", data: message });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to react to message" });
  }
});router.post('/forward-message/:id', async (req, res) => {
  const { id } = req.params;
  const { senderId, recipientId } = req.body;

  try {
    // Find the original message
    const originalMessage = await Message.findById(id);

    if (!originalMessage) {
      return res.status(404).json({ error: "Original message not found" });
    }

    // Create a new message as a forward
    const forwardedMessage = new Message({
      sender: senderId,
      recipient: recipientId,
      content: `Forwarded: ${originalMessage.content}`, // Add a prefix to show it's forwarded
      reactions: [], // No reactions for a forwarded message
      timestamp: Date.now(),
    });

    await forwardedMessage.save();

    res.status(201).json({
      message: "Message forwarded successfully",
      data: forwardedMessage,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to forward message" });
  }
});
router.patch('/pin-message/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const messageToPin = await Message.findById(id);

    if (!messageToPin) {
      return res.status(404).json({ error: "Message not found" });
    }

    // Unpin any other message in the same conversation
    await Message.updateMany(
      {
        $or: [
          { sender: messageToPin.sender, recipient: messageToPin.recipient },
          { sender: messageToPin.recipient, recipient: messageToPin.sender },
        ],
        pinned: true,
      },
      { pinned: false }
    );

    // Pin the new message
    messageToPin.pinned = true;
    await messageToPin.save();

    res.status(200).json({ message: "Message pinned successfully", data: messageToPin });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to pin message" });
  }
});
router.patch('/unpin-message/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const message = await Message.findById(id);

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    message.pinned = false;
    await message.save();

    res.status(200).json({ message: "Message unpinned successfully", data: message });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to unpin message" });
  }
});

router.patch('/edit-message/:id', async (req, res) => {
  const { id } = req.params;
  const { senderId, newContent } = req.body;

  try {
    const message = await Message.findById(id);

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    // Check if the sender matches
    if (message.sender.toString() !== senderId) {
      return res.status(403).json({ error: "You can only edit your own messages" });
    }

    // Update the content
    message.content = newContent;
    await message.save();

    res.status(200).json({ message: "Message updated", data: message });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update the message" });
  }
});

// Send a message
router.post("/messages", async (req, res) => {
  const { senderId, recipientId, groupId, content,sendername } = req.body;

  if (!senderId || (!recipientId && !groupId) || !content) {
    return res.status(400).json({ error: "Sender, recipient/group, and content are required." });
  }

  try {
    const message = await Message.create({
      sender: senderId,
      recipient: groupId ? null : recipientId,
      group: groupId || null,
      sendername:sendername,
      content,
    });

    res.status(201).json({ message: "Message sent successfully", data: message });
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({ error: "Failed to send message" });
  }
});

      router.delete("/clear-chat", async (req, res) => {
  const { userId, recipientId, groupId } = req.body;

  if (!userId || (!recipientId && !groupId)) {
    return res.status(400).json({
      error: "UserId and recipientId or groupId are required.",
    });
  }

  try {
    const filter = groupId
      ? { group: groupId }
      : {
          $or: [
            { sender: userId, recipient: recipientId },
            { sender: recipientId, recipient: userId },
          ],
        };

    const result = await Message.updateMany(
      filter,
      {
        $addToSet: {
          deletedFor: userId,
        },
      }
    );

    res.status(200).json({
      message: "Chat cleared successfully",
      modifiedCount: result.modifiedCount,
    });

  } catch (error) {
    console.error("Error clearing chat:", error);

    res.status(500).json({
      error: "Failed to clear chat",
    });
  }
});
router.delete("/chats", async (req, res) => {
  const { userId, otherUserId } = req.body;

  if (!userId || !otherUserId) {
    return res.status(400).json({ error: "Both user IDs are required" });
  }

  try {
    const result = await Message.deleteMany({
      $or: [
        { sender: userId, recipient: otherUserId },
        { sender: otherUserId, recipient: userId },
      ],
    });

    res.status(200).json({
      message: "Chat deleted successfully",
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error("Error deleting chat:", error);
    res.status(500).json({ error: "Failed to delete chat" });
  }
});

// Get messages between two users

router.get("/messages", async (req, res) => {
  const { userId1, userId2, groupId } = req.query;

  try {
    let messages;

    if (groupId) {
      // Fetch group messages
      messages = await Message.find({
        group: groupId,
        deletedFor: { $ne: userId1 },
      })
        .populate("sender")
        .sort({ timestamp: 1 });

    } else if (userId1 && userId2) {
      // Fetch user-to-user messages
      messages = await Message.find({
        $and: [
          {
            $or: [
              { sender: userId1, recipient: userId2 },
              { sender: userId2, recipient: userId1 },
            ],
          },
          {
            deletedFor: { $ne: userId1 },
          },
        ],
      })
        .populate("sender")
        .sort({ timestamp: 1 });

    } else {
      return res.status(400).json({
        error: "Either userId1 and userId2 or groupId is required.",
      });
    }

    res.json(messages);

  } catch (error) {
    console.error("Error fetching messages:", error);

    res.status(500).json({
      error: "Failed to fetch messages",
    });
  }
});

// Example in Node.js/Express
router.delete('/delete-message/:id', async (req, res) => {
  const { id } = req.params;
  const { senderId } = req.body; // Sender's ID should be included in the request body

  try {
    const message = await Message.findById(id);

    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }
  console.log("Message ID:", id);
    console.log("Message sender:", message.sender);
    console.log("Request senderId:", senderId);
    console.log(
      "Comparison:",
      message.sender?.toString() === senderId?.toString()
    );

    // Ensure only the sender can delete their message
    if (message.sender.toString() !== senderId.toString()) {
      return res.status(403).json({ error: "You can only delete your own messages" });
    }

    await message.deleteOne();
    res.status(200).json({ message: "Message deleted successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete the message" });
  }
});

module.exports = router;
