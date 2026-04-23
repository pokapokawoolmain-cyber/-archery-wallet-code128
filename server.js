import express from "express";
import dotenv from "dotenv";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { fileURLToPath } from "node:url";
import { PKPass } from "passkit-generator";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3000);

const MODEL_PATH = path.join(__dirname, "wallet-model", "member.pass");
const CERTS_PATH = path.join(__dirname, "certs");
const MEMBER_NUMBER_REGEX = /^0\d{6}$/;
const BARCODE_PREFIX = "";
const BARCODE_SUFFIX = "";
const LOG_ENDPOINT = "https://script.google.com/macros/s/AKfycbxGwQtZs_IcFwr95nmgbyYiTQ1Sen5qrbESzOZr6xEYfhlQK7YT85WV3W4lzBmkQ0g-/exec";

/* =========================
   Google Wallet 用 追加設定
   ========================= */
const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL || "https://archery-wallet-code128.onrender.com";

const GOOGLE_WALLET_ISSUER_ID = process.env.GOOGLE_WALLET_ISSUER_ID || "";
const GOOGLE_WALLET_CLASS_SUFFIX =
  process.env.GOOGLE_WALLET_CLASS_SUFFIX || "archery_membership_card_class_v1";
const GOOGLE_SERVICE_ACCOUNT_EMAIL =
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
const GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY =
  (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/\\n/g, "\n");

const GOOGLE_WALLET_LOGO_URL = `${PUBLIC_BASE_URL}/google-wallet-logo.png`;
const GOOGLE_WALLET_CARD_TITLE = "ARCHERY MEMBERSHIP CARD";

app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "archery-wallet-starter",
    barcodeFormat: "PKBarcodeFormatCode128",
    memberNumberRule: "7桁の数字（例: 0012345）",
    barcodeRule: "先頭に0を1つ追加した8桁",
  });
});

/* =========================
   Apple Wallet（既存・変更なし）
   ========================= */
app.get("/pass", async (req, res) => {
  try {
    const name = sanitize(req.query.name, 40);
    const memberNumber = sanitizeMemberNumber(req.query.memberNumber);
    const barcodeNumber = toBarcodeNumber(memberNumber);
    const affiliation = sanitize(req.query.affiliation, 60);
    const requestId = sanitize(req.query.requestId, 80);
    console.log("PASS HIT", { name, memberNumber, barcodeNumber, affiliation });
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
          process.env.PASS_DESCRIPTION || "Archery Membership Card",
      }
    );

    pass.headerFields.splice(0, pass.headerFields.length);

    pass.primaryFields.splice(
      0,
      pass.primaryFields.length,
      { key: "memberNumber", label: "会員番号", value: memberNumber }
    );

    pass.secondaryFields.splice(
      0,
      pass.secondaryFields.length,
      { key: "name", label: "氏名", value: name }
    );

    pass.auxiliaryFields.splice(
      0,
      pass.auxiliaryFields.length,
      { key: "affiliation", label: "所属", value: affiliation }
    );

    pass.backFields.splice(
      0,
      pass.backFields.length,
      {
        key: "barcodeRule",
        label: "バーコード文字列",
        value: barcodeNumber,
      },
      {
        key: "barcodeType",
        label: "バーコード形式",
        value: "Code 128",
      },
      {
        key: "notice",
        label: "注意",
        value:
          "※本カードは連盟非公認オンライン会員カードです。正式な会員確認は主催者運用に従ってください。",
      }
    );

    const barcode = {
      message: barcodeNumber,
      format: "PKBarcodeFormatCode128",
      messageEncoding: "iso-8859-1",
    };

    pass.setBarcodes(barcode);
    pass.barcode = barcode;

    const buffer = await pass.getAsBuffer();

    res.set({
      "Content-Type": "application/vnd.apple.pkpass",
      "Content-Disposition": `attachment; filename="archery-member-${memberNumber}.pkpass"`,
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

app.get("/generate", async (req, res) => {
  try {
    const name = sanitize(req.query.name, 40);
    const memberNumber = sanitizeMemberNumber(req.query.memberNumber);
    const affiliation = sanitize(req.query.affiliation, 60);
    const requestId = sanitize(req.query.requestId, 80);

    console.log("GENERATE HIT", { name, memberNumber, affiliation, requestId });

    if (!name || !memberNumber || !affiliation || !requestId) {
      return res.status(400).send(renderValidationError());
    }

    try {
      const resLog = await fetch(LOG_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          name,
          memberNumber,
          affiliation,
          requestId,
          ip: req.headers["x-forwarded-for"] || req.socket.remoteAddress || "",
          userAgent: req.headers["user-agent"] || "",
          isReissue: false
        }),
        redirect: "follow"
      });

      const text = await resLog.text();
      console.log("LOG STATUS:", resLog.status);
      console.log("LOG RESULT:", text);
    } catch (logError) {
      console.error("LOG ERROR:", logError);
    }

    const query = new URLSearchParams({
      name,
      memberNumber,
      affiliation,
      requestId
    }).toString();

    return res.redirect(`/pass?${query}`);
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

/* =========================
   Google Wallet 用 追加ルート
   ========================= */
app.get("/google-pass", async (req, res) => {
  try {
    const name = sanitize(req.query.name, 40);
    const memberNumber = sanitizeMemberNumber(req.query.memberNumber);
    const affiliation = sanitize(req.query.affiliation, 60);

    if (!name || !memberNumber || !affiliation) {
      return res.status(400).send(renderValidationError());
    }

    if (
      !GOOGLE_WALLET_ISSUER_ID ||
      !GOOGLE_SERVICE_ACCOUNT_EMAIL ||
      !GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
    ) {
      return res.status(500).send(`
        <html lang="ja">
          <body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:24px;background:#0f172a;color:#e5e7eb;">
            <h1>Google Wallet 設定が不足しています</h1>
            <p><code>GOOGLE_WALLET_ISSUER_ID</code> / <code>GOOGLE_SERVICE_ACCOUNT_EMAIL</code> / <code>GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY</code> を設定してください。</p>
          </body>
        </html>
      `);
    }

    const walletObject = buildGoogleWalletObject({
      issuerId: GOOGLE_WALLET_ISSUER_ID,
      classSuffix: GOOGLE_WALLET_CLASS_SUFFIX,
      name,
      memberNumber,
      affiliation,
    });

    const saveUrl = createGoogleWalletSaveUrl({
      issuerEmail: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      privateKey: GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
      object: walletObject,
    });

    return res.redirect(saveUrl);
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

function toBarcodeNumber(memberNumber) {
  return memberNumber.padStart(8, "0");
}

/* =========================
   Google Wallet 用関数
   ========================= */
function buildGoogleWalletObject({
  issuerId,
  classSuffix,
  name,
  memberNumber,
  affiliation,
}) {
  const barcodeNumber = toBarcodeNumber(memberNumber);
  const objectSuffix = crypto
    .createHash("sha256")
    .update(`${name}:${memberNumber}:${affiliation}`)
    .digest("hex")
    .slice(0, 24);

  return {
    id: `${issuerId}.${objectSuffix}`,
    classId: `${issuerId}.${classSuffix}`,
    state: "ACTIVE",

    cardTitle: {
      defaultValue: {
        language: "en-US",
        value: "ARCHERY MEMBERSHIP CARD",
      },
    },

    header: {
  defaultValue: {
    language: "ja-JP",
    value: "会員証",
  },
},
	  
    barcode: {
      type: "CODE_128",
      value: barcodeNumber,
      alternateText: memberNumber,
    },
  };
}

function createGoogleWalletSaveUrl({
  issuerEmail,
  privateKey,
  object,
}) {
  const claims = {
    iss: issuerEmail,
    aud: "google",
    typ: "savetowallet",
    origins: [],
    payload: {
      genericObjects: [object],
    },
  };

  const token = jwt.sign(claims, privateKey, {
    algorithm: "RS256",
  });

  return `https://pay.google.com/gp/v/save/${token}`;
}
function renderValidationError() {
  return `
    <html lang="ja">
      <body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;padding:24px;background:#0f172a;color:#e5e7eb;">
        <h1>入力内容を確認してください</h1>
        <p>会員番号は <strong>7桁の数字</strong> で入力してください。</p>
        <p>例: <code>0012345</code></p>
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