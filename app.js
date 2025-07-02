require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 8080;

// Set up EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'supersecret123',
    resave: false,
    saveUninitialized: false,
  })
);

// Dummy email data (replace with real logic later)
const sampleEmails = [
  {
    id: '1',
    status: 'NEW',
    dateFormatted: '2025-07-02',
    timeFormatted: '08:30 AM',
    vehicle: 'Toyota Camry',
    vin: '1HGCM82633A123456',
    plate: 'ABC123',
    state: 'TX',
  },
  {
    id: '2',
    status: 'PROCESSED',
    dateFormatted: '2025-07-01',
    timeFormatted: '11:00 AM',
    vehicle: 'Honda Accord',
    vin: '1HGCM82633A789012',
    plate: 'XYZ789',
    state: 'CA',
  },
];

// Authentication middleware
function isAuthenticated(req, res, next) {
  if (req.session.user) {
    return next();
  }
  res.redirect('/login');
}

// Login routes
app.get('/login', (req, res) => {
  res.send(`
    <h1>Login</h1>
    <form method="POST" action="/login">
      <input name="username" placeholder="Username" />
      <input name="password" type="password" placeholder="Password" />
      <button type="submit">Login</button>
    </form>
  `);
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const adminUser = process.env.ADMIN_USER;
  const adminPass = process.env.ADMIN_PASSWORD;

  console.log('Login attempt:', { username, password });
  console.log('Expected:', { adminUser, adminPass });

  if (username === adminUser && password === adminPass) {
    req.session.user = username;
    res.redirect('/dashboard');
  } else {
    res.status(401).send('Unauthorized');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Dashboard route
app.get('/dashboard', isAuthenticated, (req, res) => {
  const emails = sampleEmails; // Replace with actual Gmail logic later
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const stats = {
    newEmails: emails.filter(e => e.status === 'NEW').length,
    totalEmails: emails.length,
    todaysEmails: emails.filter(e => e.dateFormatted === today).length,
  };

  res.render('dashboard', {
    lastCheck: new Date().toLocaleString(),
    gmailConnected: true, // Or use real Gmail auth logic
    emails,
    stats,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ vehicle-insight-app running on port ${PORT}`);
});
