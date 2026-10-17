const express = require("express");
const router = express.Router();
const { loginOrRegister } = require("../controllers/authController");

router.post("/login", loginOrRegister);

module.exports = router;