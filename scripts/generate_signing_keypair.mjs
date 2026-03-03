#!/usr/bin/env node
import crypto from 'node:crypto';

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pubDer = publicKey.export({ format: 'der', type: 'spki' });
const privDer = privateKey.export({ format: 'der', type: 'pkcs8' });

console.log(JSON.stringify({
  algorithm: 'ed25519',
  publicKeySpkiBase64: Buffer.from(pubDer).toString('base64'),
  privateKeyPkcs8Base64: Buffer.from(privDer).toString('base64')
}, null, 2));
