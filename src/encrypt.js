'use strict';
const crypto = require('crypto');

/**
 * Encrypt a JS object with AES-256-GCM + PBKDF2 key derivation.
 * @param {object} data - The data to encrypt
 * @param {string} password - The encryption password
 * @returns {{ salt: string, iv: string, tag: string, data: string }} Base64-encoded payload
 */
function encrypt(data, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const json = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  };
}

module.exports = { encrypt };
