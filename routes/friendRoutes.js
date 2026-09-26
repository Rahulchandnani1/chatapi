const express = require("express");
const router = express.Router();

const User = require("../models/User");
const FriendRequest = require("../models/FriendRequest");

router.post("/request", async (req, res) => {
  try {
    const { senderId, receiverId } = req.body;

    if (!senderId || !receiverId) {
      return res.status(400).json({
        error: "Sender and receiver are required",
      });
    }

    if (senderId === receiverId) {
      return res.status(400).json({
        error: "You cannot send a friend request to yourself",
      });
    }

    const sender = await User.findById(senderId);
    const receiver = await User.findById(receiverId);

    if (!sender || !receiver) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    // Check if already friends
    if (sender.friends?.includes(receiverId)) {
      return res.status(400).json({
        error: "You are already friends",
      });
    }

    // Check existing pending request
    const existingRequest = await FriendRequest.findOne({
      $or: [
        {
          sender: senderId,
          receiver: receiverId,
          status: "pending",
        },
        {
          sender: receiverId,
          receiver: senderId,
          status: "pending",
        },
      ],
    });

    if (existingRequest) {
      return res.status(400).json({
        error: "Friend request already exists",
      });
    }

    const request = await FriendRequest.create({
      sender: senderId,
      receiver: receiverId,
    });

    res.status(201).json({
      message: "Friend request sent",
      request,
    });
  } catch (error) {
    console.error("Send friend request error:", error);

    res.status(500).json({
      error: "Failed to send friend request",
    });
  }
});
router.get("/requests/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const requests = await FriendRequest.find({
      receiver: userId,
      status: "pending",
    })
      .populate("sender", "username email image about")
      .sort({ createdAt: -1 });

    res.json(requests);
  } catch (error) {
    console.error("Get friend requests error:", error);

    res.status(500).json({
      error: "Failed to get friend requests",
    });
  }
});
router.post("/accept/:requestId", async (req, res) => {
  try {
    const { requestId } = req.params;

    const request = await FriendRequest.findById(requestId);

    if (!request) {
      return res.status(404).json({
        error: "Friend request not found",
      });
    }

    if (request.status !== "pending") {
      return res.status(400).json({
        error: "This friend request is no longer pending",
      });
    }

    const sender = await User.findById(request.sender);
    const receiver = await User.findById(request.receiver);

    if (!sender || !receiver) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    // Add each user to the other's friends list
    if (!sender.friends.includes(receiver._id)) {
      sender.friends.push(receiver._id);
    }

    if (!receiver.friends.includes(sender._id)) {
      receiver.friends.push(sender._id);
    }

    await sender.save();
    await receiver.save();

    // Update request status
    request.status = "accepted";
    await request.save();

    res.json({
      message: "Friend request accepted",
    });
  } catch (error) {
    console.error("Accept friend request error:", error);

    res.status(500).json({
      error: "Failed to accept friend request",
    });
  }
});
router.post("/reject/:requestId", async (req, res) => {
  try {
    const { requestId } = req.params;

    const request = await FriendRequest.findById(requestId);

    if (!request) {
      return res.status(404).json({
        error: "Friend request not found",
      });
    }

    if (request.status !== "pending") {
      return res.status(400).json({
        error: "This friend request is no longer pending",
      });
    }

    request.status = "rejected";
    await request.save();

    res.json({
      message: "Friend request rejected",
    });
  } catch (error) {
    console.error("Reject friend request error:", error);

    res.status(500).json({
      error: "Failed to reject friend request",
    });
  }
});
router.get("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId)
      .populate("friends", "username email image about status");

    if (!user) {
      return res.status(404).json({
        error: "User not found",
      });
    }

    res.json(user.friends);
  } catch (error) {
    console.error("Get friends error:", error);

    res.status(500).json({
      error: "Failed to get friends",
    });
  }
});
module.exports = router;
