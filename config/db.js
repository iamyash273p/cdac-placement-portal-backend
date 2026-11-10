const mysql = require('mysql2');
require('dotenv').config();

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD =
  process.env.DB_PASSWORD && process.env.DB_PASSWORD !== 'password'
    ? process.env.DB_PASSWORD
    : 'root';
const DB_NAME = process.env.DB_NAME || 'cdac_placement';

// Create MySQL Connection Pool
const db = mysql.createPool({
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Helper to run sequential startup queries
function runQuery(connection, sql, params = []) {
  return new Promise((resolve, reject) => {
    connection.query(sql, params, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
}

// Auto-create Database and Tables on Startup if not created yet
async function initializeDatabase() {
  const initConnection = mysql.createConnection({
    host: DB_HOST,
    user: DB_USER,
    password: DB_PASSWORD
  });

  try {
    await runQuery(initConnection, `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``);
    await runQuery(initConnection, `USE \`${DB_NAME}\``);

    await runQuery(
      initConnection,
      `CREATE TABLE IF NOT EXISTS students (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        prn VARCHAR(50) NOT NULL UNIQUE,
        email VARCHAR(120) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        phone VARCHAR(20) DEFAULT '',
        address VARCHAR(255) DEFAULT '',
        passout_year INT DEFAULT 2026,
        tenth_marks VARCHAR(20) DEFAULT '',
        twelfth_marks VARCHAR(20) DEFAULT '',
        degree_marks VARCHAR(20) DEFAULT '',
        cmce_marks VARCHAR(20) DEFAULT '',
        ccee_marks VARCHAR(20) DEFAULT '',
        status VARCHAR(30) DEFAULT 'Unplaced',
        company VARCHAR(100) DEFAULT '-',
        photo LONGTEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    );

    await runQuery(
      initConnection,
      `CREATE TABLE IF NOT EXISTS admins (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(120) NOT NULL UNIQUE,
        phone VARCHAR(20) DEFAULT '',
        password VARCHAR(255) NOT NULL,
        photo LONGTEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    );

    await runQuery(
      initConnection,
      `CREATE TABLE IF NOT EXISTS drives (
        id INT AUTO_INCREMENT PRIMARY KEY,
        company VARCHAR(100) NOT NULL,
        role VARCHAR(100) NOT NULL,
        package VARCHAR(50) NOT NULL,
        location VARCHAR(100) NOT NULL,
        drive_date VARCHAR(50) NOT NULL,
        passout_year INT DEFAULT 2026,
        criteria VARCHAR(255) DEFAULT '',
        status VARCHAR(30) DEFAULT 'Active',
        rounds_completed INT DEFAULT 2,
        total_rounds INT DEFAULT 3,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    );

    await runQuery(
      initConnection,
      `CREATE TABLE IF NOT EXISTS drive_shortlists (
        id INT AUTO_INCREMENT PRIMARY KEY,
        drive_id INT NOT NULL,
        student_id INT NOT NULL,
        rounds_completed INT DEFAULT 2,
        total_rounds INT DEFAULT 3,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_drive_student (drive_id, student_id)
      )`
    );

    initConnection.end();
    console.log(`Connected to local MySQL database (${DB_NAME}).`);
  } catch (err) {
    console.error('Error initializing MySQL database:', err.message);
    initConnection.end();
  }
}

module.exports = { db, initializeDatabase };
