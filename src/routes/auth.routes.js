const express = require('express');
const authService = require('../services/auth.service');
const { attachUser, requireAuth, COOKIE_NAME } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const env = require('../config/env');

const router = express.Router();

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'strict',
    maxAge: env.session.absoluteDays * 86400000,
    path: '/',
  };
}

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const { name, email, password, currency } = req.body || {};
    const user = await authService.register({ name, email, password, currency }, req.ip);
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    const { token, user } = await authService.login({ email, password }, req.ip, req.get('user-agent'));
    res.cookie(COOKIE_NAME, token, cookieOptions());
    res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', attachUser, requireAuth, async (req, res, next) => {
  try {
    await authService.logout(req.currentUser.sessionId);
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
