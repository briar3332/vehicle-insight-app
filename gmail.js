const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

// Create OAuth2 client
function createOAuth2Client() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH));
  const { client_secret, client_id, redirect_uris } = credentials.web;
  
  return new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0] // Use the first redirect URI
  );
}

// Get authorization URL
async function getAuthUrl() {
  const oAuth2Client = createOAuth2Client();
  
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent' // Force consent screen to ensure we get refresh token
  });
  
  console.log('Generated auth URL:', authUrl);
  return authUrl;
}

// Exchange authorization code for tokens
async function getTokenFromCode(code) {
  const oAuth2Client = createOAuth2Client();
  
  try {
    console.log('Exchanging code for tokens...');
    const { tokens } = await oAuth2Client.getToken(code);
    console.log('Received tokens:', {
      access_token: tokens.access_token ? 'Present' : 'Missing',
      refresh_token: tokens.refresh_token ? 'Present' : 'Missing',
      expiry_date: tokens.expiry_date
    });
    
    oAuth2Client.setCredentials(tokens);
    
    // Save tokens to file for persistence
    const tokenPath = path.join(__dirname, 'token.json');
    fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
    console.log('Tokens saved to:', tokenPath);
    
    return oAuth2Client;
  } catch (error) {
    console.error('Error exchanging code for tokens:', error);
    throw new Error('Failed to exchange authorization code for tokens: ' + error.message);
  }
}

// Create authenticated client from stored session data
function createAuthenticatedClient(authData) {
  const oAuth2Client = createOAuth2Client();
  oAuth2Client.setCredentials({
    access_token: authData.access_token,
    refresh_token: authData.refresh_token,
    token_type: authData.token_type,
    expiry_date: authData.expiry_date
  });
  return oAuth2Client;
}

// Parse VIN and vehicle info from email content
function parseVehicleInfo(emailContent, subject) {
  const vehicleInfo = {
    vin: null,
    vehicle: 'Unknown',
    plate: null,
    state: null
  };

  console.log('=== PARSING EMAIL CONTENT ===');
  
  // Clean up content and remove HTML tags for better parsing
  let cleanContent = emailContent
    .replace(/<[^>]*>/g, ' ')  // Remove HTML tags
    .replace(/&nbsp;/g, ' ')   // Replace HTML spaces
    .replace(/\s+/g, ' ')      // Normalize whitespace
    .trim();
    
  console.log('Cleaned content length:', cleanContent.length);
  console.log('Cleaned content preview (first 1000 chars):', cleanContent.substring(0, 1000));
  
  // Extract VIN from subject first (most reliable)
  const subjectVinMatch = subject.match(/VIN:\s*([A-HJ-NPR-Z0-9]{17})/i);
  if (subjectVinMatch) {
    vehicleInfo.vin = subjectVinMatch[1];
    console.log('✓ Found VIN in subject:', vehicleInfo.vin);
  }
  
  // Also try to find VIN in content
  if (!vehicleInfo.vin) {
    const contentVinPatterns = [
      /VIN\s+([A-HJ-NPR-Z0-9]{17})/i,
      /VIN:\s*([A-HJ-NPR-Z0-9]{17})/i,
      /VIN\s*([A-HJ-NPR-Z0-9]{17})/i,
      /([A-HJ-NPR-Z0-9]{17})/g  // Just look for any 17-char VIN pattern
    ];
    
    for (const pattern of contentVinPatterns) {
      const match = cleanContent.match(pattern);
      if (match) {
        vehicleInfo.vin = match[1];
        console.log(`✓ Found VIN in content: ${vehicleInfo.vin} using pattern: ${pattern}`);
        break;
      }
    }
  }
  
  // Now extract the table data with even more flexible patterns
  const extractedData = {};
  
  // Try to find the data table structure - look for key-value pairs
  const tablePatterns = [
    // Plate ID patterns
    { key: 'plateId', patterns: [
      /Plate\s*ID\s+([A-Z0-9]{3,8})/i,
      /Plate ID\s+([A-Z0-9]{3,8})/i,
      /PlateID\s+([A-Z0-9]{3,8})/i,
      /Plate\s+([A-Z0-9]{3,8})/i
    ]},
    
    // State ID patterns  
    { key: 'stateId', patterns: [
      /State\s*ID\s+([A-Z]{2})/i,
      /State ID\s+([A-Z]{2})/i,
      /StateID\s+([A-Z]{2})/i,
      /State\s+([A-Z]{2})/i
    ]},
    
    // Vehicle Make patterns
    { key: 'vehicleMake', patterns: [
      /Vehicle\s*Make\s+([A-Za-z]+)/i,
      /Vehicle Make\s+([A-Za-z]+)/i,
      /VehicleMake\s+([A-Za-z]+)/i,
      /Make\s+([A-Za-z]+)/i
    ]},
    
    // Vehicle Model patterns
    { key: 'vehicleModel', patterns: [
      /Vehicle\s*Model\s+([A-Za-z0-9\s]+?)(?=\s+Vehicle|\s+Price|\s+DRN|\s+State|\s+Plate|$)/i,
      /Vehicle Model\s+([A-Za-z0-9\s]+?)(?=\s+Vehicle|\s+Price|\s+DRN|\s+State|\s+Plate|$)/i,
      /VehicleModel\s+([A-Za-z0-9\s]+?)(?=\s+Vehicle|\s+Price|\s+DRN|\s+State|\s+Plate|$)/i,
      /Model\s+([A-Za-z0-9\s]+?)(?=\s+Vehicle|\s+Price|\s+DRN|\s+State|\s+Plate|$)/i
    ]},
    
    // Vehicle Year patterns
    { key: 'vehicleYear', patterns: [
      /Vehicle\s*Year\s+(\d{4})/i,
      /Vehicle Year\s+(\d{4})/i,
      /VehicleYear\s+(\d{4})/i,
      /Year\s+(\d{4})/i
    ]},
    
    // Vehicle Color patterns
    { key: 'vehicleColor', patterns: [
      /Vehicle\s*Color\s+([A-Za-z]+)/i,
      /Vehicle Color\s+([A-Za-z]+)/i,
      /VehicleColor\s+([A-Za-z]+)/i,
      /Color\s+([A-Za-z]+)/i
    ]}
  ];

  // Try each pattern set
  tablePatterns.forEach(({ key, patterns }) => {
    for (const pattern of patterns) {
      const match = cleanContent.match(pattern);
      if (match && match[1] && !extractedData[key]) {
        extractedData[key] = match[1].trim();
        console.log(`✓ Found ${key}: "${extractedData[key]}" using pattern: ${pattern}`);
        break;
      }
    }
    
    if (!extractedData[key]) {
      console.log(`✗ Could not find ${key}`);
    }
  });

  // Build vehicle description from extracted data
  if (extractedData.vehicleYear && extractedData.vehicleMake && extractedData.vehicleModel) {
    const year = extractedData.vehicleYear;
    const make = extractedData.vehicleMake;
    const model = extractedData.vehicleModel.trim();
    const color = extractedData.vehicleColor || '';
    
    vehicleInfo.vehicle = color ? 
      `${year} ${make} ${model} ${color}` : 
      `${year} ${make} ${model}`;
    
    console.log(`✓ Built vehicle description: "${vehicleInfo.vehicle}"`);
  } else {
    console.log('✗ Could not build vehicle description - missing required fields');
    console.log('Available data:', extractedData);
    
    // Try to find ANY vehicle information in the content as fallback
    const fallbackPatterns = [
      /(\d{4})\s+([A-Za-z]+)\s+([A-Za-z0-9]+)\s+([A-Za-z]+)/i,  // 2007 Chevrolet Tahoe gray
      /(\d{4})\s+([A-Za-z]+)\s+([A-Za-z0-9]+)/i                // 2007 Chevrolet Tahoe
    ];
    
    for (const pattern of fallbackPatterns) {
      const match = cleanContent.match(pattern);
      if (match) {
        if (match[4]) {
          vehicleInfo.vehicle = `${match[1]} ${match[2]} ${match[3]} ${match[4]}`;
        } else {
          vehicleInfo.vehicle = `${match[1]} ${match[2]} ${match[3]}`;
        }
        console.log(`✓ Fallback vehicle description: "${vehicleInfo.vehicle}"`);
        break;
      }
    }
  }

  // Set final values
  vehicleInfo.plate = extractedData.plateId || '';
  vehicleInfo.state = extractedData.stateId ? extractedData.stateId.toUpperCase() : '';

  console.log('=== FINAL PARSING RESULTS ===');
  console.log('VIN:', vehicleInfo.vin || 'Not found');
  console.log('Vehicle:', vehicleInfo.vehicle);
  console.log('Plate:', vehicleInfo.plate || 'Not found');
  console.log('State:', vehicleInfo.state || 'Not found');
  console.log('=== END PARSING ===\n');
  
  return vehicleInfo;
}

// Get DRN emails with vehicle information
async function getDRNEmails(authData) {
  try {
    const auth = createAuthenticatedClient(authData);
    const gmail = google.gmail({ version: 'v1', auth });
    
    console.log('Searching for DRN emails...');
    
    // Try multiple search queries - start broad and get more specific
    const searchQueries = [
      'from:BuyItNow@digitalrecognition.net',
      'from:BuyItNow@digitalrecognition.net DRN',
      'from:BuyItNow@digitalrecognition.net "Buy It Now Hit"',
      'from:BuyItNow@digitalrecognition.net VIN'
    ];
    
    let allMessages = [];
    
    for (const searchQuery of searchQueries) {
      console.log(`\n--- Trying search query: "${searchQuery}" ---`);
      
      try {
        const listResponse = await gmail.users.messages.list({
          userId: 'me',
          maxResults: 50,
          q: searchQuery
        });
        
        const messages = listResponse.data.messages || [];
        console.log(`Found ${messages.length} messages with query: "${searchQuery}"`);
        
        if (messages.length > 0) {
          // Add messages to our collection, avoiding duplicates
          messages.forEach(msg => {
            if (!allMessages.find(existing => existing.id === msg.id)) {
              allMessages.push(msg);
            }
          });
          
          // If we found messages with the broad search, break and use those
          if (searchQuery === 'from:BuyItNow@digitalrecognition.net' && messages.length > 0) {
            console.log(`Using results from broad search: ${messages.length} messages`);
            break;
          }
        }
      } catch (searchError) {
        console.error(`Error with search query "${searchQuery}":`, searchError.message);
      }
    }
    
    console.log(`\nTotal unique messages found: ${allMessages.length}`);
    
    if (allMessages.length === 0) {
      console.log('No DRN emails found with any search query');
      return [];
    }
    
    // Get details for each message
    const emails = [];
    const messagesToProcess = allMessages.slice(0, 20); // Process up to 20 emails
    
    for (const message of messagesToProcess) {
      try {
        const msgResponse = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'full'
        });
        
        const headers = msgResponse.data.payload.headers || [];
        const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || 'No Subject';
        const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || 'Unknown Sender';
        const date = headers.find(h => h.name.toLowerCase() === 'date')?.value || new Date().toISOString();
        
        console.log(`\n=== Processing Email ${message.id} ===`);
        console.log('Subject:', subject);
        console.log('From:', from);
        
        // Check if this is actually a DRN email by checking subject
        const isDRNEmail = subject.toLowerCase().includes('drn') && 
                          subject.toLowerCase().includes('buy it now hit') && 
                          subject.toLowerCase().includes('vin');
        
        if (!isDRNEmail) {
          console.log('❌ Skipping - not a DRN email based on subject');
          continue;
        }
        
        console.log('✅ This is a DRN email - processing...');
        
        // Get email body content
        let emailContent = '';
        if (msgResponse.data.payload.body && msgResponse.data.payload.body.data) {
          emailContent = Buffer.from(msgResponse.data.payload.body.data, 'base64').toString();
        } else if (msgResponse.data.payload.parts) {
          // Check for text/plain or text/html parts
          for (const part of msgResponse.data.payload.parts) {
            if (part.mimeType === 'text/plain' || part.mimeType === 'text/html') {
              if (part.body && part.body.data) {
                emailContent += Buffer.from(part.body.data, 'base64').toString();
              }
            }
          }
        }
        
        console.log('Email content length:', emailContent.length);
        
        // Show a bit more content for debugging
        const contentPreview = emailContent.replace(/\s+/g, ' ').substring(0, 800);
        console.log('Email content preview:', contentPreview);
        
        // Parse vehicle information
        const vehicleInfo = parseVehicleInfo(emailContent, subject);
        
        // Include email even if VIN parsing fails - we can still show basic info
        const emailData = {
          id: message.id,
          subject: subject,
          from: from,
          date: new Date(date),
          dateFormatted: new Date(date).toLocaleDateString(),
          timeFormatted: new Date(date).toLocaleTimeString(),
          snippet: msgResponse.data.snippet || 'No preview',
          vin: vehicleInfo.vin || 'VIN not found',
          vehicle: vehicleInfo.vehicle,
          plate: vehicleInfo.plate || '',
          state: vehicleInfo.state || '',
          status: 'NEW', // Default status
          content: emailContent
        };
        
        console.log('Final email data:', emailData);
        emails.push(emailData);
        
      } catch (msgError) {
        console.error(`Error fetching message ${message.id}:`, msgError.message);
      }
    }
    
    // Sort by date (newest first)
    emails.sort((a, b) => b.date - a.date);
    
    console.log(`\n✅ Successfully processed ${emails.length} DRN emails`);
    return emails;
    
  } catch (error) {
    console.error('Error fetching DRN emails:', error);
    
    // If it's an authentication error, throw a specific error
    if (error.code === 401 || error.message.includes('invalid_token')) {
      throw new Error('Gmail authentication expired. Please reconnect.');
    }
    
    throw new Error('Failed to fetch DRN emails: ' + error.message);
  }
}

// Get email statistics
function getEmailStats(emails) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const newEmails = emails.filter(email => email.status === 'NEW').length;
  const todaysEmails = emails.filter(email => {
    const emailDate = new Date(email.date);
    emailDate.setHours(0, 0, 0, 0);
    return emailDate.getTime() === today.getTime();
  }).length;
  
  return {
    newEmails,
    totalEmails: emails.length,
    todaysEmails
  };
}

// Check if we have stored tokens
function hasStoredTokens() {
  const tokenPath = path.join(__dirname, 'token.json');
  return fs.existsSync(tokenPath);
}

// Load stored tokens
function loadStoredTokens() {
  const tokenPath = path.join(__dirname, 'token.json');
  if (fs.existsSync(tokenPath)) {
    return JSON.parse(fs.readFileSync(tokenPath));
  }
  return null;
}

module.exports = {
  getAuthUrl,
  getTokenFromCode,
  getDRNEmails,
  getEmailStats,
  hasStoredTokens,
  loadStoredTokens,
  createAuthenticatedClient
};