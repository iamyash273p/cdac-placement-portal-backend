const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/register', authController.registerStudent);
router.post('/login', authController.login);
router.put('/profile', authController.updateProfile);

module.exports = router;
