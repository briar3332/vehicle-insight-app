const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'defaultsecret',
  resave: false,
  saveUninitialized: true
}));

// Middleware to protect routes
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    next();
  } else {
    res.redirect('/login');
  }
}

// Routes
app.get('/', (req, res) => {
  res.redirect('/login');
});

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;

  // 🔍 DEBUG: Show what the app sees from env
  console.log('Login attempt:', { username, password });
  console.log('Expected:', {
    adminUser: process.env.ADMIN_USER,
    adminPass: process.env.ADMIN_PASSWORD
  });

  if (
    username === process.env.ADMIN_USER &&
    password === process.env.ADMIN_PASSWORD
  ) {
    req.session.authenticated = true;
    res.redirect('/dashboard');
  } else {
    res.render('login', { error: 'Invalid credentials' });
  }
});

app.get('/dashboard', requireAuth, (req, res) => {
  const lastCheck = new Date().toLocaleString();
  const stats = {
    newEmails: 1,
    totalEmails: 2,
    todayEmails: 1
  };

  const emailHistory = [
    {
      status: 'NEW',
      datetime: '2025-07-02, 08:30 AM',
      vehicle: 'Toyota Camry',
      vin: '1HGCM82633A123456',
      plate: 'ABC123',
      state: 'TX',
      spotted: '2025-07-02, 08:30 AM',
      processed: false
    },
    {
      status: 'PROCESSED',
      datetime: '2025-07-01, 11:00 AM',
      vehicle: 'Honda Accord',
      vin: '1HGCM82633A789012',
      plate: 'XYZ789',
      state: 'CA',
      spotted: '2025-07-01, 11:00 AM',
      processed: true
    }
  ];

  res.render('dashboard', { lastCheck, stats, emailHistory });
});

app.listen(PORT, () => {
  console.log(`✅ vehicle-insight-app running on port ${PORT}`);
});
