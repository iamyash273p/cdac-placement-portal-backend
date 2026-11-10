const express = require('express');
const router = express.Router();
const studentController = require('../controllers/studentController');

// Public / Student endpoints
router.get('/students', studentController.getAllStudents);
router.get('/student/shortlisted-drives', studentController.getStudentShortlistedDrives);

// Admin student management endpoints
router.post('/admin/students', studentController.addStudent);
router.put('/admin/students/:id', studentController.updateStudent);
router.delete('/admin/students/:id', studentController.deleteStudent);

module.exports = router;
