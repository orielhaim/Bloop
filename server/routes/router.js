import { Hono } from 'hono';
import activate from './activate';
import admin from './admin';
import auth from './auth';
import keys from './keys';

const router = new Hono();

router.route('/admin', admin);
router.route('/activate', activate);
router.route('/keys', keys);
router.route('/auth', auth);

export default router;
