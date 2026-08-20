const fs = require('fs');
const files = fs.readdirSync('server/routes').filter(f => f.endsWith('.js'));
for (const file of files) {
  const p = 'server/routes/' + file;
  const content = fs.readFileSync(p, 'utf8');
  const updated = content.replace(
    'if (!orgId || !userId || !role) {',
    "if (!userId || !role || (!orgId && role !== 'super_admin')) {"
  );
  if (content !== updated) {
    fs.writeFileSync(p, updated);
    console.log('Updated ' + file);
  }
}
