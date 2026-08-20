import express from 'express';
import { seedDemoData, DEMO_CONFIG } from '../../scripts/seed-demo-account.mjs';

const router = express.Router();

/**
 * POST /api/demo/reset-data
 * Resets the demo account state cleanly for testing & troubleshooting.
 */
router.post('/reset-data', async (req, res) => {
  try {
    await seedDemoData();
    res.json({
      success: true,
      message: 'Demo environment reset to initial state with realistic data.',
      demoConfig: {
        landlordEmail: DEMO_CONFIG.landlordEmail,
        caretakerPhone: DEMO_CONFIG.caretakerPhone,
        orgName: DEMO_CONFIG.orgName
      }
    });
  } catch (err) {
    console.error('Demo reset error:', err);
    res.status(500).json({ success: false, error: 'Failed to reset demo environment.' });
  }
});

/**
 * POST /api/demo/login
 * Quick demo login for testing (role: 'landlord' | 'caretaker')
 */
router.post('/login', async (req, res) => {
  try {
    const { role = 'landlord' } = req.body;

    if (role === 'caretaker') {
      res.json({
        success: true,
        user: {
          id: DEMO_CONFIG.caretakerId,
          email: DEMO_CONFIG.caretakerEmail,
          phone_number: DEMO_CONFIG.caretakerPhone,
          full_name: 'Francis Caretaker',
          role: 'caretaker'
        },
        organization: {
          id: DEMO_CONFIG.orgId,
          name: DEMO_CONFIG.orgName,
          account_number: DEMO_CONFIG.orgAccount
        },
        token: `demo-token-${DEMO_CONFIG.caretakerId}`
      });
      return;
    }

    // Default Landlord Login
    res.json({
      success: true,
      user: {
        id: DEMO_CONFIG.landlordId,
        email: DEMO_CONFIG.landlordEmail,
        phone_number: '+254700000000',
        full_name: 'Demo Landlord',
        role: 'owner'
      },
      organization: {
        id: DEMO_CONFIG.orgId,
        name: DEMO_CONFIG.orgName,
        account_number: DEMO_CONFIG.orgAccount
      },
      token: `demo-token-${DEMO_CONFIG.landlordId}`
    });
  } catch (err) {
    console.error('Demo login error:', err);
    res.status(500).json({ success: false, error: 'Demo authentication failed.' });
  }
});

export default router;
