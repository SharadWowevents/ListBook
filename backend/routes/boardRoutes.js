const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const { getBoard, saveBoard } = require("../controllers/boardController");

router.use(auth);
router.get("/", getBoard);
router.put("/", saveBoard);

module.exports = router;