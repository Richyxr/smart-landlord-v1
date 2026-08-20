import { db } from '../db.js';

export async function generateMeterReadingNudges(pgDb = null) {
  const nudgesGenerated = [];
  const now = new Date();
  const dayOfMonth = now.getDate();

  if (pgDb) {
    try {
      const orgsRes = await pgDb.query('SELECT id, name FROM organizations WHERE status = $1', ['active']);
      for (const org of orgsRes.rows) {
        const propsRes = await pgDb.query(
          'SELECT id, name FROM properties WHERE organization_id = $1 AND status = $2',
          [org.id, 'active']
        );

        for (const prop of propsRes.rows) {
          const unitsRes = await pgDb.query(
            'SELECT COUNT(*) as count FROM units WHERE property_id = $1 AND status = $2',
            [prop.id, 'occupied']
          );
          const occupiedCount = parseInt(unitsRes.rows[0]?.count || '0', 10);
          if (occupiedCount === 0) continue;

          // Check if meter reading nudge already exists for this month window
          const existingNudge = await pgDb.query(
            `SELECT id FROM system_nudges 
             WHERE organization_id = $1 AND property_id = $2 AND category = 'meter_reading' AND is_resolved = false
             AND created_at >= NOW() - INTERVAL '5 days'`,
            [org.id, prop.id]
          );

          if (existingNudge.rows.length === 0) {
            const title = 'End-of-Month Meter Reading Reminder';
            const message = `${occupiedCount} occupied unit(s) at ${prop.name} need water/electric meter readings input before monthly invoices generate on the 1st.`;
            
            // Caretaker nudge
            const caretNudge = await pgDb.query(
              `INSERT INTO system_nudges 
               (organization_id, property_id, target_role, category, severity, title, message, action_label, action_url, action_type, action_payload)
               VALUES ($1, $2, 'caretaker', 'meter_reading', 'warning', $3, $4, 'Input Meter Readings', '/caretaker?action=meter_entry', 'NAVIGATE', $5)
               RETURNING *`,
              [org.id, prop.id, title, message, JSON.stringify({ property_id: prop.id, action: 'meter_entry' })]
            );

            // Landlord nudge
            const landNudge = await pgDb.query(
              `INSERT INTO system_nudges 
               (organization_id, property_id, target_role, category, severity, title, message, action_label, action_url, action_type, action_payload)
               VALUES ($1, $2, 'landlord', 'meter_reading', 'info', $3, $4, 'Audit Readings', '/properties', 'NAVIGATE', $5)
               RETURNING *`,
              [org.id, prop.id, title, message, JSON.stringify({ property_id: prop.id })]
            );

            nudgesGenerated.push(caretNudge.rows[0], landNudge.rows[0]);
          }
        }
      }
    } catch (err) {
      console.error('Error generating pgDb meter reading nudges:', err);
    }
  } else {
    // JSON backend logic using db.find and db.insert
    const orgs = (db.find('organizations', {}) || []).filter(o => o.status !== 'deleted');
    const properties = db.find('properties', {}) || [];
    const units = db.find('units', {}) || [];
    const nudges = db.get('system_nudges') || [];

    for (const org of orgs) {
      const orgProps = properties.filter(p => p.organization_id === org.id && p.status === 'active');
      for (const prop of orgProps) {
        const propUnits = units.filter(u => u.property_id === prop.id && u.status === 'occupied');
        if (propUnits.length === 0) continue;

        const existing = nudges.find(n => 
          n.organization_id === org.id && 
          n.property_id === prop.id && 
          n.category === 'meter_reading' && 
          !n.is_resolved
        );

        if (!existing) {
          const title = 'End-of-Month Meter Reading Reminder';
          const message = `${propUnits.length} occupied unit(s) at ${prop.name} require water & power meter readings before invoicing on the 1st.`;

          const caretNudge = db.insert('system_nudges', {
            organization_id: org.id,
            property_id: prop.id,
            target_role: 'caretaker',
            category: 'meter_reading',
            severity: 'warning',
            title,
            message,
            action_label: 'Input Meter Readings',
            action_url: '/caretaker?action=meter_entry',
            action_type: 'NAVIGATE',
            action_payload: { property_id: prop.id, action: 'meter_entry' },
            is_resolved: false
          });

          const landNudge = db.insert('system_nudges', {
            organization_id: org.id,
            property_id: prop.id,
            target_role: 'landlord',
            category: 'meter_reading',
            severity: 'info',
            title,
            message,
            action_label: 'Audit Readings',
            action_url: '/properties',
            action_type: 'NAVIGATE',
            action_payload: { property_id: prop.id },
            is_resolved: false
          });

          nudgesGenerated.push(caretNudge, landNudge);
        }
      }
    }
  }

  return nudgesGenerated;
}

export async function generateUnallocatedPaymentNudges(pgDb = null) {
  const nudgesGenerated = [];
  if (pgDb) {
    try {
      const pendingRes = await pgDb.query(
        `SELECT organization_id, COUNT(*) as count 
         FROM payment_evidence 
         WHERE status = 'pending' 
         GROUP BY organization_id`
      );

      for (const row of pendingRes.rows) {
        const count = parseInt(row.count, 10);
        if (count === 0) continue;

        const existing = await pgDb.query(
          `SELECT id FROM system_nudges 
           WHERE organization_id = $1 AND category = 'reconciliation' AND is_resolved = false`,
          [row.organization_id]
        );

        if (existing.rows.length === 0) {
          const nudge = await pgDb.query(
            `INSERT INTO system_nudges 
             (organization_id, target_role, category, severity, title, message, action_label, action_url, action_type)
             VALUES ($1, 'landlord', 'reconciliation', 'warning', $2, $3, 'Review Receipts', '/payment-evidence', 'NAVIGATE')
             RETURNING *`,
            [
              row.organization_id,
              'Payment Evidence Awaiting Approval',
              `${count} tenant payment receipt(s) submitted are waiting for manual verification and approval.`
            ]
          );
          nudgesGenerated.push(nudge.rows[0]);
        }
      }
    } catch (err) {
      console.error('Error generating pgDb payment nudges:', err);
    }
  } else {
    const evidenceList = db.get('payment_evidence') || [];
    const nudges = db.get('system_nudges') || [];

    const pendingByOrg = {};
    evidenceList.filter(e => e.status === 'pending').forEach(e => {
      pendingByOrg[e.organization_id] = (pendingByOrg[e.organization_id] || 0) + 1;
    });

    for (const [orgId, count] of Object.entries(pendingByOrg)) {
      const numericOrgId = Number(orgId);
      const existing = nudges.find(
        n => n.organization_id === numericOrgId && n.category === 'reconciliation' && !n.is_resolved
      );

      if (!existing && count > 0) {
        const nudge = db.insert('system_nudges', {
          organization_id: numericOrgId,
          target_role: 'landlord',
          category: 'reconciliation',
          severity: 'warning',
          title: 'Payment Evidence Awaiting Approval',
          message: `${count} tenant payment receipt(s) submitted are waiting for manual verification and approval.`,
          action_label: 'Review Receipts',
          action_url: '/payment-evidence',
          action_type: 'NAVIGATE',
          is_resolved: false
        });
        nudgesGenerated.push(nudge);
      }
    }
  }

  return nudgesGenerated;
}

export async function generateCameraDiagnosticsNudges(pgDb = null) {
  const nudgesGenerated = [];
  if (pgDb) {
    try {
      const offlineRes = await pgDb.query(
        `SELECT c.id, c.name, c.organization_id, c.property_id, p.name as property_name
         FROM property_cameras c
         JOIN properties p ON c.property_id = p.id
         WHERE c.status = 'offline'`
      );

      for (const cam of offlineRes.rows) {
        const existing = await pgDb.query(
          `SELECT id FROM system_nudges 
           WHERE organization_id = $1 AND category = 'security' AND action_payload->>'camera_id' = $2 AND is_resolved = false`,
          [cam.organization_id, String(cam.id)]
        );

        if (existing.rows.length === 0) {
          const nudge = await pgDb.query(
            `INSERT INTO system_nudges 
             (organization_id, property_id, target_role, category, severity, title, message, action_label, action_url, action_type, action_payload)
             VALUES ($1, $2, 'landlord', 'security', 'critical', $3, $4, 'Check Camera', '/cameras', 'NAVIGATE', $5)
             RETURNING *`,
            [
              cam.organization_id,
              cam.property_id,
              'Camera Signal Lost',
              `Camera "${cam.name}" at ${cam.property_name} is currently offline. Check connection or IP configuration.`,
              JSON.stringify({ camera_id: cam.id })
            ]
          );
          nudgesGenerated.push(nudge.rows[0]);
        }
      }
    } catch (err) {
      console.error('Error generating pgDb camera nudges:', err);
    }
  } else {
    const cameras = db.get('cameras') || db.get('property_cameras') || [];
    const properties = db.get('properties') || [];
    const nudges = db.get('system_nudges') || [];

    const offlineCameras = cameras.filter(c => c.status === 'offline');
    for (const cam of offlineCameras) {
      const prop = properties.find(p => p.id === cam.property_id);
      const propName = prop ? prop.name : 'Property';
      const existing = nudges.find(
        n => n.organization_id === cam.organization_id &&
             n.category === 'security' &&
             n.action_payload?.camera_id === cam.id &&
             !n.is_resolved
      );

      if (!existing) {
        const nudge = db.insert('system_nudges', {
          organization_id: cam.organization_id,
          property_id: cam.property_id,
          target_role: 'landlord',
          category: 'security',
          severity: 'critical',
          title: 'Camera Signal Lost',
          message: `Camera "${cam.name}" at ${propName} is currently offline. Check network connection.`,
          action_label: 'Check Camera',
          action_url: '/cameras',
          action_type: 'NAVIGATE',
          action_payload: { camera_id: cam.id },
          is_resolved: false
        });
        nudgesGenerated.push(nudge);
      }
    }
  }

  return nudgesGenerated;
}

export async function runSystemIntelligenceEvaluator(pgDb = null) {
  const meterNudges = await generateMeterReadingNudges(pgDb);
  const paymentNudges = await generateUnallocatedPaymentNudges(pgDb);
  const cameraNudges = await generateCameraDiagnosticsNudges(pgDb);
  return {
    evaluated_at: new Date().toISOString(),
    nudges_generated: [...meterNudges, ...paymentNudges, ...cameraNudges]
  };
}

export async function getNudgesForUser({ role, organizationId }, pgDb = null) {
  if (pgDb) {
    try {
      const res = await pgDb.query(
        `SELECT * FROM system_nudges 
         WHERE (organization_id = $1 OR organization_id IS NULL) 
           AND (target_role = $2 OR target_role = 'all')
           AND is_resolved = false
         ORDER BY 
           CASE severity
             WHEN 'critical' THEN 1
             WHEN 'warning' THEN 2
             WHEN 'info' THEN 3
             ELSE 4
           END,
           created_at DESC`,
        [organizationId, role]
      );
      return res.rows;
    } catch (err) {
      console.error('Error fetching pgDb nudges:', err);
      return [];
    }
  } else {
    const nudges = db.get('system_nudges') || [];
    const orgIdNum = Number(organizationId);

    const filtered = nudges.filter(n => 
      (n.organization_id === orgIdNum || !n.organization_id) &&
      (n.target_role === role || n.target_role === 'all') &&
      !n.is_resolved
    );

    const severityWeight = { critical: 1, warning: 2, info: 3, success: 4 };
    filtered.sort((a, b) => (severityWeight[a.severity] || 4) - (severityWeight[b.severity] || 4));

    return filtered;
  }
}

export async function resolveNudge({ nudgeId, userId }, pgDb = null) {
  if (pgDb) {
    try {
      const res = await pgDb.query(
        `UPDATE system_nudges 
         SET is_resolved = true, resolved_at = now(), resolved_by = $1, updated_at = now()
         WHERE id = $2 RETURNING *`,
        [userId, nudgeId]
      );
      return res.rows[0] || null;
    } catch (err) {
      console.error('Error resolving pgDb nudge:', err);
      return null;
    }
  } else {
    const nudgeNumId = Number(nudgeId);
    const updatedList = db.update('system_nudges', nudgeNumId, {
      is_resolved: true,
      resolved_at: new Date().toISOString(),
      resolved_by: userId
    });
    return updatedList[0] || null;
  }
}
