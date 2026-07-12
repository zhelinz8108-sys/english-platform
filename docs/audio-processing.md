# Minute Earth 人声分离与部署

这套流程使用 Demucs 从原始听力素材中分离讲话声，并将净化后的 MP3
安全替换到网站中。源目录不会被修改，输出目录保留原来的文件夹层级和文件名。

## 安装音频处理依赖

```powershell
python -m pip install -r scripts/requirements-audio.txt
```

NVIDIA 显卡和 CUDA 可用时会默认使用 GPU；其他环境会自动回退到 CPU。

## 批量分离讲话声

```powershell
python scripts/separate-minute-earth-vocals.py `
  --source "D:\path\to\Minute Earth" `
  --output "D:\path\to\Minute Earth_仅讲话"
```

脚本会输出 192 kbps MP3，并在每条音频完成后立即落盘。再次执行同一命令时，
已经完成的非空文件会自动跳过，因此可以安全地断点续跑。如需重新生成所有文件，
增加 `--overwrite`。

## 替换网站音频

确保 PostgreSQL、MinIO 和 API 所需的本地基础服务已经启动，然后执行：

```powershell
pnpm --filter @english/api import:minute-earth -- `
  --source="D:\path\to\Minute Earth_仅讲话" `
  --replace=true
```

`--replace=true` 会沿用现有素材记录、对象键和列表顺序，只替换 MP3 内容并更新
文件大小与 SHA-256。省略该参数时，已存在的序号仍会按原逻辑跳过。

音频文件、`.env`、数据库和对象存储数据不应提交到 Git；生产部署应将净化音频
上传至腾讯云 COS 等私有对象存储，并通过临时签名 URL 播放。
