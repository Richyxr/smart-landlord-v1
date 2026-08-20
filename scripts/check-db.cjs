const fs = require('fs');
const d = JSON.parse(fs.readFileSync('server/data/db.json'));
const activeSessions = d.support_access_sessions.filter(s => s.status === 'active');
console.log('Active support sessions:', activeSessions.length);
if (activeSessions.length > 0) console.log('Sessions:', JSON.stringify(activeSessions, null, 2));
const adminUser = d.users.find(u => u.email === 'admin@smartlandlord.com');
console.log('Admin user:', adminUser);
