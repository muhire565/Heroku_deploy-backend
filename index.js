const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const moment = require('moment'); // For date formatting
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const PDFDocument = require('pdfkit');
const app = express();
const mysql = require('mysql');

// Middleware
app.use(cors());
app.use(bodyParser.json());

const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'musinguziverelian23',
  database: 'school_management',
});

connection.connect((err) => {
  if (err) throw err;
  console.log('Connected to the database!');
});

const users = [
  {
    userId: 25291,
    role: 'registrar',
    password: 'registrarPassword', // Plain text password (for initialization)
    hashedPassword: '', // To be populated later with the hashed password
  },
  {
    userId: 25292,
    role: 'finance',
    password: 'financePassword', // Plain text password (for initialization)
    hashedPassword: '', // To be populated later with the hashed password
  },
  {
    userId: 25293,
    role: 'director', // New director user
    password: 'directorPassword', // Plain text password (for initialization)
    hashedPassword: '', // To be populated later with the hashed password
  },
];

// Hash passwords and store them
const hashPasswords = async () => {
  for (let user of users) {
    const salt = await bcrypt.genSalt(10);
    user.hashedPassword = await bcrypt.hash(user.password, salt);
    console.log(`Hashed password for ${user.role}:`, user.hashedPassword);
    // Clear plain text passwords (not needed after hashing)
    user.password = undefined;
  }
};

hashPasswords();

// Login route
app.post('/api/login', async (req, res) => {
  const { user_id, password, role } = req.body;

  // Validate input fields
  if (!user_id || !password || !role) {
    return res
      .status(400)
      .json({ success: false, message: 'All fields are required' });
  }

  // Find the user based on user_id and role
  const user = users.find((u) => u.userId === user_id && u.role === role);

  if (!user) {
    return res
      .status(401)
      .json({ success: false, message: 'Invalid user ID or role' });
  }

  // Compare the entered password with the stored hashed password
  const isPasswordValid = await bcrypt.compare(password, user.hashedPassword);

  if (!isPasswordValid) {
    return res
      .status(401)
      .json({ success: false, message: 'Invalid password' });
  }

  // If both user_id and password are correct, generate a JWT token with roles included
  const token = jwt.sign(
    { id: user.userId, role: user.role },
    'musinguziverelian23',
    {
      expiresIn: '1h',
    }
  );

  res.json({ success: true, token });
});

// Get all students
// Get all students with course name
// Get all students with course name and tuition fee
app.get('/students', (req, res) => {
  const sql = `
    SELECT students.id, students.first_name, students.last_name, students.email, students.phone, 
           courses.course_name, courses.tuition_fee,
           IFNULL(SUM(payments.amount_paid), 0) AS total_paid,
           (courses.tuition_fee - IFNULL(SUM(payments.amount_paid), 0)) AS balance
    FROM students
    JOIN courses ON students.course_id = courses.id
    LEFT JOIN payments ON students.id = payments.student_id
    GROUP BY students.id, courses.course_name, courses.tuition_fee
  `;
  connection.query(sql, (err, results) => {
    if (err) throw err;
    res.json(results);
  });
});

app.get('/coursez', (req, res) => {
  connection.query('SELECT * FROM courses', (err, results) => {
    if (err) throw err;
    res.json(results);
  });
});

// Add a new student
app.post('/students', (req, res) => {
  const { first_name, last_name, email, phone, address, course_id, on_loan } =
    req.body;
  const sql = `INSERT INTO students (first_name, last_name, email, phone, address, course_id, on_loan) VALUES (?, ?, ?, ?, ?, ?, ?)`;
  connection.query(
    sql,
    [first_name, last_name, email, phone, address, course_id, on_loan],
    (err, result) => {
      if (err) throw err;
      res.send('Student added successfully!');
    }
  );
});

app.get('/students/on-loan', (req, res) => {
  const sql = `
    SELECT 
      students.id,
      students.first_name,
      students.last_name,
      students.email,
      students.address,
      students.phone,
      courses.tuition_fee,
      courses.course_name
      
    FROM 
      students
    JOIN 
      courses ON students.course_id = courses.id
    WHERE 
      students.on_loan = TRUE;
  `;

  connection.query(sql, (err, results) => {
    if (err) {
      console.error('Database query error:', err);
      res.status(500).send('Server error');
      return;
    }
    res.json(results);
  });
});
// Get a student by ID
app.get('/students/:id', async (req, res) => {
  const studentId = req.params.id;

  try {
    const student = await connection.query(
      'SELECT * FROM students WHERE id = ?',
      [studentId]
    );

    if (student.length > 0) {
      res.status(200).json(student[0]);
    } else {
      res.status(404).json({ message: 'Student not found' });
    }
  } catch (error) {
    console.error('Error fetching student by ID:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Record a payment
app.post('/payments', (req, res) => {
  console.log('Request body:', req.body); // Log the incoming request data

  const { student_id, amount_paid, payment_method, fee_type_id } = req.body;

  // Step 1: Insert the payment record
  const sqlInsertPayment = `INSERT INTO payments (student_id, amount_paid, payment_date, payment_method, fee_type_id) 
                            VALUES (?, ?, NOW(), ?, ?)`;

  connection.query(
    sqlInsertPayment,
    [student_id, amount_paid, payment_method, fee_type_id],
    (err) => {
      if (err) {
        console.error('Error inserting payment:', err);
        res.status(500).send('Failed to record payment.');
        return;
      }

      // Step 2: Update the balance for the specific fee type
      const sqlUpdateBalance = `UPDATE fee_balances 
                                SET balance = balance - ? 
                                WHERE student_id = ? AND fee_type_id = ?`;

      connection.query(
        sqlUpdateBalance,
        [amount_paid, student_id, fee_type_id],
        (err) => {
          if (err) {
            console.error('Error updating balance:', err);
            res.status(500).send('Failed to update balance.');
            return;
          }

          res.send('Payment recorded successfully!');
        }
      );
    }
  );
});
app.get('/students/by-fee/:id', (req, res) => {
  const feeName = req.params.feeName;

  // SQL query to get students who have paid for a certain fee type
  const sql = `
    SELECT s.id, s.first_name, s.last_name, p.amount_paid, p.payment_date
    FROM students s
    JOIN payments p ON s.id = p.student_id
    JOIN fee_types f ON p.fee_type_id = f.id
    WHERE f.fee_name = ?
  `;

  connection.query(sql, [feeName], (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve students' });
    }
    res.json(results);
  });
});

app.get('/fee-types', (req, res) => {
  const sql = 'SELECT * FROM fee_types';

  connection.query(sql, (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve fee types' });
    }
    res.json(results);
  });
});

app.get('/fee-types/:id', (req, res) => {
  const feeTypeId = req.params.id;
  const sql = 'SELECT * FROM fee_types WHERE id = ?';

  connection.query(sql, [feeTypeId], (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to retrieve fee type' });
    }
    if (results.length === 0) {
      return res.status(404).json({ error: 'Fee type not found' });
    }
    res.json(results[0]);
  });
});

app.get('/students/:id/payment-statement', (req, res) => {
  const studentId = req.params.id;
  const sql = `
    SELECT students.first_name, students.last_name, courses.course_name, courses.tuition_fee, payments.amount_paid, payments.payment_date, payments.payment_method,
           (SELECT IFNULL(SUM(amount_paid), 0) FROM payments WHERE student_id = ?) AS total_paid,
           (SELECT IFNULL(tuition_fee, 0) FROM courses WHERE id = (SELECT course_id FROM students WHERE id = ?)) - 
           (SELECT IFNULL(SUM(amount_paid), 0) FROM payments WHERE student_id = ?) AS outstanding_balance
    FROM payments
    JOIN students ON payments.student_id = students.id
    JOIN courses ON students.course_id = courses.id
    WHERE students.id = ?
  `;

  connection.query(
    sql,
    [studentId, studentId, studentId, studentId],
    (err, results) => {
      if (err) {
        console.error('Error fetching payment statement:', err);
        res.status(500).send('Internal Server Error');
        return;
      }

      // Generate PDF
      const doc = new PDFDocument();
      let filename = `payment-statement-${studentId}.pdf`;
      filename = encodeURIComponent(filename);

      // Set headers for PDF download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);

      // Add a border around the page
      doc.rect(20, 20, doc.page.width - 40, doc.page.height - 40).stroke();

      // Add company logo (replace 'logoUrl' with your actual image path or URL)
      const logoUrl = './assets/logo.png'; // Update with your image address
      doc.image(logoUrl, 50, 30, { width: 100 });

      // Add content below the logo
      doc
        .fontSize(16)
        .text('Eduserve Education Agency', 50, 100, { align: 'center' });
      doc
        .fontSize(14)
        .text(
          `Payment Statement for ${results[0].first_name} ${results[0].last_name}`,
          { align: 'center' }
        );
      doc.text(`Course: ${results[0].course_name}`);
      doc.text(`Tuition Fee: ${results[0].tuition_fee.toLocaleString()}`); // Format with commas
      doc.text(
        `Date of Report: ${moment().format('ddd MMM DD YYYY [at] hh:mm A')}`
      );
      doc.moveDown();

      // Define table column positions and widths
      const tableStartX = 50;
      const tableStartY = doc.y;
      const columnWidths = {
        date: 120,
        amount: 100,
        balance: 120,
        method: 100,
      };

      // Add table headers
      const headerStyle = {
        fontSize: 12,
        font: 'Helvetica-Bold',
        textColor: 'black',
        backgroundColor: '#f0f0f0',
        padding: 10,
      };

      const cellStyle = {
        fontSize: 12,
        font: 'Helvetica',
        textColor: 'black',
        padding: 5,
      };

      // Draw table headers
      doc
        .rect(tableStartX, tableStartY, columnWidths.date, 30)
        .fillAndStroke(headerStyle.backgroundColor, 'black');
      doc
        .rect(
          tableStartX + columnWidths.date,
          tableStartY,
          columnWidths.amount,
          30
        )
        .fillAndStroke(headerStyle.backgroundColor, 'black');
      doc
        .rect(
          tableStartX + columnWidths.date + columnWidths.amount,
          tableStartY,
          columnWidths.balance,
          30
        )
        .fillAndStroke(headerStyle.backgroundColor, 'black');
      doc
        .rect(
          tableStartX +
            columnWidths.date +
            columnWidths.amount +
            columnWidths.balance,
          tableStartY,
          columnWidths.method,
          30
        )
        .fillAndStroke(headerStyle.backgroundColor, 'black');

      doc
        .fillColor(headerStyle.textColor)
        .fontSize(headerStyle.fontSize)
        .font(headerStyle.font)
        .text('Date of Payment', tableStartX + 10, tableStartY + 10, {
          width: columnWidths.date,
          align: 'center',
        })
        .text(
          'Amount Paid',
          tableStartX + columnWidths.date + 10,
          tableStartY + 10,
          { width: columnWidths.amount, align: 'center' }
        )
        .text(
          'Balance',
          tableStartX + columnWidths.date + columnWidths.amount + 10,
          tableStartY + 10,
          { width: columnWidths.balance, align: 'center' }
        )
        .text(
          'Method',
          tableStartX +
            columnWidths.date +
            columnWidths.amount +
            columnWidths.balance +
            10,
          tableStartY + 10,
          { width: columnWidths.method, align: 'center' }
        );
      doc.moveDown();

      // Draw table rows with striped effect
      let runningBalance = results[0].tuition_fee;
      results.forEach((payment, i) => {
        runningBalance -= payment.amount_paid;
        const y = doc.y;

        // Alternate row colors for the striped effect
        const rowColor = i % 2 === 0 ? '#f9f9f9' : '#ffffff';
        doc
          .rect(
            tableStartX,
            y - 5,
            columnWidths.date +
              columnWidths.amount +
              columnWidths.balance +
              columnWidths.method,
            25
          )
          .fill(rowColor);

        // Fill the row with payment data
        doc
          .fillColor(cellStyle.textColor)
          .fontSize(cellStyle.fontSize)
          .font(cellStyle.font)
          .text(
            moment(payment.payment_date).format('ddd MMM DD YYYY'),
            tableStartX + 10,
            y,
            { width: columnWidths.date, align: 'center' }
          )
          .text(
            `${payment.amount_paid.toLocaleString()}`, // Format amount with commas
            tableStartX + columnWidths.date + 10,
            y,
            { width: columnWidths.amount, align: 'center' }
          )
          .text(
            `${Math.max(runningBalance, 0).toLocaleString()}`, // Format balance with commas
            tableStartX + columnWidths.date + columnWidths.amount + 10,
            y,
            { width: columnWidths.balance, align: 'center' }
          )
          .text(
            payment.payment_method || 'N/A',
            tableStartX +
              columnWidths.date +
              columnWidths.amount +
              columnWidths.balance +
              10,
            y,
            { width: columnWidths.method, align: 'center' }
          );

        doc.moveDown();
      });

      // Finalize the PDF
      doc.end();
      doc.pipe(res);
    }
  );
});

app.get('/students/:studentId/course-balance', (req, res) => {
  const studentId = req.params.studentId;

  const sql = `
    SELECT
      c.course_name,
      c.tuition_fee AS total_tuition_fee,
      IFNULL(SUM(p.amount_paid), 0) AS total_amount_paid,
      (c.tuition_fee - IFNULL(SUM(p.amount_paid), 0)) AS remaining_balance
    FROM
      students s
    JOIN
      courses c ON s.course_id = c.id
    LEFT JOIN
      payments p ON s.id = p.student_id
    WHERE
      s.id = ?
    GROUP BY
      c.course_name, c.tuition_fee;
  `;

  connection.query(sql, [studentId], (err, results) => {
    if (err) {
      console.error(
        `Error fetching course and balance for student ${studentId}:`,
        err
      );
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    res.json(results[0]);
  });
});
// Add a new course
app.post('/courses', (req, res) => {
  const { course_name, tuition_fee, description } = req.body;
  const sql = `INSERT INTO courses (course_name, tuition_fee, description) VALUES (?, ?, ?)`;
  connection.query(
    sql,
    [course_name, tuition_fee, description],
    (err, result) => {
      if (err) throw err;
      res.send('Course added successfully!');
    }
  );
});

app.get('/count', (req, res) => {
  const sql = 'SELECT COUNT(*) AS count FROM students';

  connection.query(sql, (err, results) => {
    if (err) {
      console.error('Error executing query:', err);
      return res.status(500).json({ error: 'Failed to fetch student count' });
    }

    res.json({ count: results[0].count });
  });
});
// Get student course and current balance
app.get('/students/:id/course', (req, res) => {
  const studentId = req.params.id;

  const sql = `
        SELECT courses.tuition_fee, IFNULL(SUM(payments.remaining_balance), courses.tuition_fee) AS remaining_balance
        FROM students
        JOIN courses ON students.course_id = courses.id
        LEFT JOIN payments ON payments.student_id = students.id
        WHERE students.id = ?
    `;

  connection.query(sql, [studentId], (err, results) => {
    if (err) throw err;
    res.json(results[0]); // Return course fee and remaining balance
  });
});

app.get('/expenses', (req, res) => {
  const { start_date, end_date } = req.query;

  let sql = 'SELECT * FROM expenses';
  const values = [];

  // If both start_date and end_date are provided, filter expenses by date range
  if (start_date && end_date) {
    sql += ' WHERE expense_date BETWEEN ? AND ?';
    values.push(start_date, end_date);
  }

  connection.query(sql, values, (err, results) => {
    if (err) {
      console.error('Error fetching expenses:', err);
      return res.status(500).json({ error: 'Error fetching expenses' });
    }
    res.json(results);
  });
});

// POST /expenses - Add a new expense
app.post('/expenses', (req, res) => {
  const { person_name, amount, expense_date, description } = req.body;

  // Validation
  if (
    !person_name ||
    typeof person_name !== 'string' ||
    person_name.length > 100
  ) {
    return res.status(400).json({ error: 'Invalid person name' });
  }
  if (isNaN(amount) || amount <= 0) {
    return res.status(400).json({ error: 'Amount must be a positive number' });
  }
  if (!expense_date || isNaN(Date.parse(expense_date))) {
    return res.status(400).json({ error: 'Invalid expense date' });
  }
  if (description && typeof description !== 'string') {
    return res.status(400).json({ error: 'Description must be a string' });
  }

  const sql =
    'INSERT INTO expenses (person_name, amount, expense_date, description) VALUES (?, ?, ?, ?)';
  const values = [person_name, amount, expense_date, description || ''];

  connection.query(sql, values, (err, results) => {
    if (err) {
      console.error('Error inserting expense:', err);
      return res.status(500).json({ error: 'Error adding expense' });
    }
    res
      .status(201)
      .json({ message: 'Expense added successfully', id: results.insertId });
  });
});

app.post('/fee-types', async (req, res) => {
  const { fee_name, amount } = req.body; // Assuming fee type consists of name and amount

  // Basic validation checks
  if (!fee_name || !amount) {
    return res.status(400).send('Name and amount are required');
  }

  if (typeof amount !== 'number' || amount <= 0) {
    return res.status(400).send('Amount must be a positive number');
  }

  try {
    // Check if the fee type already exists
    const checkQuery = 'SELECT * FROM fee_types WHERE fee_name = ?';
    const existingFeeTypes = await new Promise((resolve, reject) => {
      connection.query(checkQuery, [fee_name], (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    // If fee type exists, return an error
    if (existingFeeTypes.length > 0) {
      return res.status(400).send('Fee type already exists');
    }

    // Insert new fee type into the database
    const sql = 'INSERT INTO fee_types (fee_name, amount) VALUES (?, ?)';
    await new Promise((resolve, reject) => {
      connection.query(sql, [fee_name, amount], (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    });

    // Respond with success
    res.status(201).send('Fee type added successfully');
  } catch (err) {
    console.error('Error adding fee type:', err);
    res.status(500).send('Failed to add fee type');
  }
});

// Start the server
app.listen(5000, () => {
  console.log('Server running on port 5000');
});
