const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

exports.loginOrRegister = async (req, res) => {
  try {
    const { name, pin, password, strictLogin } = req.body;
    const trimmedName = (name || "").trim();
    // Support either 'password' or 'pin' field from client/MCP
    const secret = (password || pin || "").trim();

    if (!trimmedName || !secret) {
      return res.status(400).json({ error: "Name and password/PIN are required." });
    }

    const usernameKey = trimmedName.toLowerCase();
    let user = await User.findOne({ usernameKey });

    if (!user) {
      // If strictLogin is true (used by MCP), do NOT create a new account
      if (strictLogin) {
        return res.status(401).json({ error: "Invalid username or password." });
      }

      // Standard web behavior: create account if new
      if (!/^\d{4}$/.test(secret)) {
        return res.status(400).json({ error: "PIN must be 4 digits." });
      }
      const salt = await bcrypt.genSalt(10);
      const pinHash = await bcrypt.hash(secret, salt);

      user = await User.create({
        usernameKey,
        displayName: trimmedName,
        pinHash,
      });
    } else {
      // Verify password/PIN against the stored bcrypt hash in MongoDB
      const isMatch = await bcrypt.compare(secret, user.pinHash);
      if (!isMatch) {
        return res.status(401).json({ error: "Invalid username or password." });
      }
    }

    const token = jwt.sign(
      { id: user._id, displayName: user.displayName },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    return res.json({
      token,
      user: { name: user.displayName, key: user.usernameKey },
      board: user.board,
    });
  } catch (err) {
    console.error("Auth error:", err);
    return res.status(500).json({ error: "Server error during authentication." });
  }
};