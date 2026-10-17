const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

exports.loginOrRegister = async (req, res) => {
  try {
    const { name, pin } = req.body;
    const trimmedName = (name || "").trim();
    const trimmedPin = (pin || "").trim();

    if (!trimmedName || trimmedName.length > 40) {
      return res.status(400).json({ error: "Valid name is required (max 40 chars)." });
    }
    if (!/^\d{4}$/.test(trimmedPin)) {
      return res.status(400).json({ error: "PIN must be 4 digits." });
    }

    const usernameKey = trimmedName.toLowerCase();
    let user = await User.findOne({ usernameKey });

    if (!user) {
      // Create new account with this 4-digit PIN
      const salt = await bcrypt.genSalt(10);
      const pinHash = await bcrypt.hash(trimmedPin, salt);

      user = await User.create({
        usernameKey,
        displayName: trimmedName,
        pinHash,
      });
    } else {
      // Verify existing account PIN
      const isMatch = await bcrypt.compare(trimmedPin, user.pinHash);
      if (!isMatch) {
        return res
          .status(401)
          .json({ error: "That PIN doesn't match this name. Try again." });
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
    return res.status(500).json({ error: "Server error during sign in." });
  }
};