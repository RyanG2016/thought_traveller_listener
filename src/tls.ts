import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import { ensureCertsDir, loadConfig, saveConfig } from './config';

interface CertificateInfo {
  certPath: string;
  keyPath: string;
  fingerprint: string;
}

function generateSelfSignedCertificate(): { cert: string; key: string } {
  // Generate RSA key pair
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: 'spki',
      format: 'pem',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'pem',
    },
  });

  // Create self-signed certificate
  // Note: Node.js doesn't have native X.509 certificate generation,
  // so we'll use a simple approach with the crypto module
  const hostname = os.hostname();
  const now = new Date();
  const oneYear = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  // For a proper self-signed certificate, we need to create the certificate structure
  // This is a simplified implementation - in production you'd use a library like 'node-forge'
  // or shell out to openssl

  // Create certificate using Node's X509Certificate support
  // Since Node 15+, we can create basic self-signed certs

  // For now, we'll use openssl via child_process for reliable certificate generation
  const certInfo = {
    subject: `/CN=${hostname}/O=Claude Traveller/OU=Self-Signed`,
    days: 365,
  };

  return {
    cert: '', // Will be populated by openssl
    key: privateKey,
  };
}

export async function generateCertificates(): Promise<CertificateInfo> {
  const { execSync } = await import('child_process');

  ensureCertsDir();
  const config = loadConfig();
  const certPath = config.network.tls.cert_path;
  const keyPath = config.network.tls.key_path;
  const hostname = os.hostname();

  // Generate self-signed certificate using openssl
  const opensslCmd = `openssl req -x509 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -sha256 -days 365 -nodes -subj "/CN=${hostname}/O=Claude Traveller/OU=Self-Signed" -addext "subjectAltName=DNS:${hostname},DNS:localhost,IP:127.0.0.1"`;

  try {
    execSync(opensslCmd, { stdio: 'pipe' });
  } catch (err) {
    throw new Error(
      'Failed to generate certificates. Please ensure OpenSSL is installed.\n' +
      `Command: ${opensslCmd}\n` +
      `Error: ${(err as Error).message}`
    );
  }

  // Calculate certificate fingerprint
  const certContent = fs.readFileSync(certPath, 'utf-8');
  const fingerprint = calculateFingerprint(certContent);

  return {
    certPath,
    keyPath,
    fingerprint,
  };
}

export function calculateFingerprint(certPem: string): string {
  // Extract the base64 content between BEGIN and END markers
  const base64Content = certPem
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s/g, '');

  const derBuffer = Buffer.from(base64Content, 'base64');
  const hash = crypto.createHash('sha256').update(derBuffer).digest('hex');

  // Format as colon-separated pairs
  return hash.toUpperCase().match(/.{2}/g)!.join(':');
}

export function getCertificateFingerprint(): string | null {
  const config = loadConfig();
  const certPath = config.network.tls.cert_path;

  if (!fs.existsSync(certPath)) {
    return null;
  }

  const certContent = fs.readFileSync(certPath, 'utf-8');
  return calculateFingerprint(certContent);
}

export function enableTls(): void {
  const config = loadConfig();
  config.network.tls.enabled = true;
  saveConfig(config);
}

export function disableTls(): void {
  const config = loadConfig();
  config.network.tls.enabled = false;
  saveConfig(config);
}
