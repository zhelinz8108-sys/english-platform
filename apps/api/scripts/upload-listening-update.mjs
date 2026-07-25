import fs from "node:fs";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const workspace = process.cwd();
const csvFile = fs
  .readdirSync(workspace)
  .find((name) => name.endsWith("1784775716008.csv"));
if (!csvFile) {
  throw new Error("未找到 AccessKey CSV 文件");
}

const csvPath = path.join(workspace, csvFile);
const archivePath = path.join(workspace, "tmp", "listening-import-update.tar.gz");
const bucket = "aurelis-english-assets-386928";
const key = "deployment/listening-import-update.tar.gz";

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

const rows = fs
  .readFileSync(csvPath, "utf8")
  .replace(/^\uFEFF/, "")
  .split(/\r?\n/)
  .filter(Boolean);
const headers = parseCsvLine(rows[0]);
const values = parseCsvLine(rows[1]);
const record = Object.fromEntries(
  headers.map((header, index) => [header.trim(), values[index]?.trim()]),
);

if (!record.AccessKeyId || !record.AccessKeySecret) {
  throw new Error("CSV 中未找到 AccessKeyId 或 AccessKeySecret");
}

const client = new S3Client({
  endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
  region: "cn-hangzhou",
  forcePathStyle: false,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
  credentials: {
    accessKeyId: record.AccessKeyId,
    secretAccessKey: record.AccessKeySecret,
  },
});

const stat = fs.statSync(archivePath);
const result = await client.send(
  new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: fs.readFileSync(archivePath),
    ContentLength: stat.size,
    ContentType: "application/gzip",
  }),
);

console.log(JSON.stringify({ bucket, key, bytes: stat.size, etag: result.ETag }));
