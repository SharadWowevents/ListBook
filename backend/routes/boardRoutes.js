const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const {
  getBoard,
  saveBoard,
  shareWithUser,
  createShareLink,
  getSharedList,
  acceptSharedList,
  getListMembers,
  updateMemberPermission,
  removeMember,
  leaveList,
} = require("../controllers/boardController");

// Public route to preview shared list (no authentication required)
router.get("/shared/:shareId", getSharedList);

// Authenticated routes
router.use(auth);
router.get("/", getBoard);
router.put("/", saveBoard);
router.post("/share-user", shareWithUser);
router.post("/share-link", createShareLink);
router.post("/accept-share", acceptSharedList);
router.get("/list/:listId/members", getListMembers);
router.put("/list/:listId/member-permission", updateMemberPermission);
router.delete("/list/:listId/member/:targetUsername", removeMember);
router.post("/list/:listId/leave", leaveList);

module.exports = router;