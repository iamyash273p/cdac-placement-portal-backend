const express = require('express');
const router = express.Router();
const driveController = require('../controllers/driveController');

// Drives & Shortlist endpoints
router.get('/drives', driveController.getAllDrives);
router.get('/drives/:driveId/shortlist', driveController.getDriveShortlist);
router.post('/admin/drives', driveController.createDrive);
router.post('/admin/drives/:driveId/shortlist', driveController.updateDriveShortlist);
router.delete('/admin/drives/:id', driveController.deleteDrive);

module.exports = router;
