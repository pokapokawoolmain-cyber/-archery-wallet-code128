import express from "express";
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { PKPass } from "passkit-generator";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3000);

const MODEL_PATH = path.join(__dirname, "wallet-model", "member.pass");
const CERTS_PATH = path.join(__dirname, "certs");
const MEMBER_NUMBER_REGEX = /^00\d{5}$/;
const BARCODE_PREFIX = "A010100";
const BARCODE_SUFFIX = "A";
const NOTICE_TEXT =
  "本カードは個人利用向けの表示用カードです。正式な会員確認は主催者運用に従ってください。";

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "archery-wallet-starter",
    barcodeFormat: "PKBarcodeFormatCode128",
    memberNumberRule: "00 + 5桁数字",
    barcodeRule: "A010100{memberNumber}A",
  });
});

app.get("/pass", async (req, res) => {
  try {
    const name = sanitize(req.query.name, 40);
    const memberNumber = sanitizeMemberNumber(req.query.memberNumber);
    const affiliation = sanitize(req.query.affiliation, 60);

    if (!name || !memberNumber || !affiliation) {
      return res.status(400).send(renderValidationError());
    }

    const certificates = await loadCertificates();

    const serialNumber = crypto
      .createHash("sha256")
      .update(`${name}:${memberNumber}:${affiliation}`)
      .digest("hex")
      .slice(0, 32);

    const pass = await PKPass.from(
      {
        model: MODEL_PATH,
        certificates,
      },
      {
        serialNumber,
        passTypeIdentifier: process.env.PASS_TYPE_IDENTIFIER,
        teamIdentifier: process.env.TEAM_IDENTIFIER,
        organizationName: process.env.ORGANIZATION_NAME,
        description:
          process.env.PASS_DESCRIPTION || "Archery Member Display Card",
      }
    );

    pass.primaryFields.splice(
      0,
      pass.primaryFields.length,
      { key: "name", label: "氏名", value: name }
    );

    pass.secondaryFields.splice(
      0,
      pass.secondaryFields.length,
      { key: "memberNumber", label: "会員番号", value: memberNumber },
      { key: "affiliation", label: "所属", value: affiliation }
    );

    pass.backFields.splice(
      0,
      pass.backFields.length,
      {
        key: "barcodeRule",
        label: "バーコード文字列",
        value: `${BARCODE_PREFIX}${memberNumber}${BARCODE_SUFFIX}`,
      },
      {
        key: "barcodeType",
        label: "バーコード形式",
        value: "Code 128",
      },
      {
        key: "notice",
        label: "注意",
        value: NOTICE_TEXT,
      }
    );

    const barcode = {
      message: buildBarcodeMessage(memberNumber),
      format: "PKBarcodeFormatCode128",
      messageEncoding: "iso-8859-1",
    };

    pass.setBarcodes(barcode);
    pass.barcode = barcode;

    const buffer = await pass.getAsBuffer();

    res.set({
      "Content-Type": "application/vnd.apple.pkpass",
      "Content-Disposition": `inline; filename="archery-member-${memberNumber}.pkpass"`,
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });

    return res.send(buffer);
  } catch (error) {
    console.error(error);
    return res.status(500).send(renderError(error));
  }
});

app.post("/generate", async (req, res) => {
  try {
    const name = sanitize(req.body.name, 40);
    const memberNumber = sanitizeMemberNumber(req.body.memberNumber);
    const affiliation = sanitize(req.body.affiliation, 60);

    if (!name || !memberNumber || !affiliation) {
      return res.status(400).send(renderValidationError());
    }

    const query = new URLSearchParams({
      name,
      memberNumber,
      affiliation,
    }).toString();

    return res.redirect(`/pass?${query}`);
  } catch (error) {
    console.error(error);
    return res.status(500).send(renderError(error));
  }
});

app.listen(port, () => {
  console.log(`archery-wallet-starter listening on http://localhost:${port}`);
});

async function loadCertificates() {
  const [wwdr, signerCert, signerKey] = await Promise.all([
    fs.readFile(path.join(CERTS_PATH, "wwdr.pem")),
    fs.readFile(path.join(CERTS_PATH, "signerCert.pem")),
    fs.readFile(path.join(CERTS_PATH, "signerKey.pem")),
  ]);

  return {
    wwdr,
    signerCert,
    signerKey,
    signerKeyPassphrase: process.env.SIGNER_KEY_PASSPHRASE || undefined,
  };
}

function sanitize(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/[\r\n\t]+/g, " ").slice(0, maxLength);
}

function sanitizeMemberNumber(value) {
  if (typeof value !== "string") return "";
  const digits = value.replace(/\D/g, "");
  if (!MEMBER_NUMBER_REGEX.test(digits)) return "";
  return digits;
}

function buildBarcodeMessage(memberNumber) {
  return `${BARCODE_PREFIX}${memberNumber}${BARCODE_SUFFIX}`;
}

function renderValidationError() {
  return `
    <html lang="ja">
      <body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:24px;background:#0f172a;color:#e5e7eb;">
        <h1>入力内容を確認してください</h1>
        <p>会員番号は <strong>00 + 5桁数字</strong> の 7 桁で入力してください。</p>
        <p>例: <code>0011464</code></p>
      </body>
    </html>
  `;
}

function renderError(error) {
  const message = String(error?.message || error || "Unknown error");
  return `
    <html lang="ja">
      <body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:24px;background:#0f172a;color:#e5e7eb;">
        <h1>生成に失敗しました</h1>
        <p>証明書または Pass 設定を確認してください。</p>
        <pre style="white-space:pre-wrap;background:#111827;padding:16px;border-radius:12px;border:1px solid #334155;">${escapeHtml(
          message
        )}</pre>
      </body>
    </html>
  `;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}