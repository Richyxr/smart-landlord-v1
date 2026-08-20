const fs = require('fs');
const d = JSON.parse(fs.readFileSync('server/data/db.json'));

// Ensure admin user has is_super_admin: true
const adminUser = d.users.find(u => u.email === 'admin@smartlandlord.com');
if (adminUser) {
  adminUser.is_super_admin = true;
  adminUser.first_name = adminUser.first_name || 'Super';
  adminUser.last_name = adminUser.last_name || 'Admin';
  console.log('Patched admin user:', adminUser);
} else {
  console.log('Admin user not found!');
}

fs.writeFileSync('server/data/db.json', JSON.stringify(d, null, 2), 'utf8');
console.log('db.json patched successfully.');
