const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false },
  content: { type: String, required: false },
  audioUrl: { type: String },
  sendername: {type:String},
  file: { type: String }, // File name stored on the server
  fileType: { type: String },
  group: { type: mongoose.Schema.Types.ObjectId, ref: "Group" },
  repliedTo: { type: mongoose.Schema.Types.ObjectId, ref: "Message", default: null },
  reactions: [
    {
      userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
      reaction: { type: String, required: true },
    },
  ],
  deleted: { type: Boolean, default: false },
   deletedFor: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],
  pinned: { type: Boolean, default: false }, 
  timestamp: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Message", messageSchema);
