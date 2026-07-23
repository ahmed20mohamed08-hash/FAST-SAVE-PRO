const express = require('express');
const cors = require('cors');
const YTDlpWrap = require('yt-dlp-wrap').default;
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// إنشاء المجلدات تلقائياً
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({ dest: UPLOADS_DIR });

const ytDlp = new YTDlpWrap();

// ===== فحص الرابط =====
app.post('/api/check', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'الرجاء إدخال رابط صحيح' });

        const info = await ytDlp.getVideoInfo([
            url,
            '--no-warnings',
            '--no-call-home'
        ]);

        res.json({
            success: true,
            title: info.title || 'فيديو بدون عنوان',
            duration: info.duration || 0,
            thumbnail: info.thumbnail || '',
            formats: [
                { id: 'best', label: '🎬 أعلى جودة متاحة' },
                { id: '720', label: '🎬 HD (720p)' },
                { id: '480', label: '🎬 متوسطة (480p)' },
                { id: 'audio', label: '🎵 صوت فقط (MP3)' }
            ]
        });
    } catch (e) {
        console.error('Check Error:', e.message);
        res.status(500).json({ error: 'فشل فحص الرابط، تأكد من صحة الرابط أو حاول لاحقاً.' });
    }
});

// ===== تحميل =====
app.post('/api/download', async (req, res) => {
    try {
        const { url, format } = req.body;
        if (!url) return res.status(400).json({ error: 'الرجاء إرسال الرابط' });

        const outputTemplate = path.join(DOWNLOADS_DIR, '%(title)s.%(ext)s');
        let args = [url, '--no-warnings'];

        if (format === 'audio') {
            args.push(
                '-f', 'ba/b',
                '-o', path.join(DOWNLOADS_DIR, '%(title)s.mp3'),
                '-x',
                '--audio-format', 'mp3',
                '--audio-quality', '192K'
            );
        } else if (format === '720') {
            args.push(
                '-f', 'bv*[height<=720]+ba/b[height<=720]/b',
                '-o', outputTemplate,
                '--recode-video', 'mp4'
            );
        } else if (format === '480') {
            args.push(
                '-f', 'bv*[height<=480]+ba/b[height<=480]/b',
                '-o', outputTemplate,
                '--recode-video', 'mp4'
            );
        } else { // best / default
            args.push(
                '-f', 'b/bv*+ba',
                '-o', outputTemplate,
                '--recode-video', 'mp4'
            );
        }

        const filesBefore = fs.readdirSync(DOWNLOADS_DIR);

        await ytDlp.execPromise(args);

        const filesAfter = fs.readdirSync(DOWNLOADS_DIR);
        const newFile = filesAfter.find(file => !filesBefore.includes(file));

        if (!newFile) {
            throw new Error('لم يتم العثور على الملف بعد التنزيل.');
        }

        res.json({
            success: true,
            filename: newFile,
            message: 'تم التحميل بنجاح!'
        });

    } catch (e) {
        console.error('Download Error:', e.message);
        res.status(500).json({ error: 'حدث خطأ أثناء تحميل الفيديو، حاول مجدداً.' });
    }
});

// ===== تحويل فيديو محلي لـ MP3 =====
app.post('/api/convert', upload.single('video'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'لم يتم رفع أي ملف' });

        const { start, end } = req.body;
        const inputPath = req.file.path;
        
        const originalName = path.parse(req.file.originalname).name;
        const outputPath = path.join(DOWNLOADS_DIR, `${originalName}.mp3`);

        let command = ffmpeg(inputPath)
            .toFormat('mp3')
            .audioBitrate(192)
            .on('end', () => {
                if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                res.json({
                    success: true,
                    filename: `${originalName}.mp3`,
                    message: 'تم التحويل بنجاح!'
                });
            })
            .on('error', (err) => {
                if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                console.error('FFmpeg Error:', err.message);
                res.status(500).json({ error: 'فشل تحويل الملف الصوتي' });
            });

        if (start) command.setStartTime(parseFloat(start));
        if (end && parseFloat(end) > parseFloat(start || 0)) {
            command.setDuration(parseFloat(end) - parseFloat(start || 0));
        }

        command.save(outputPath);
    } catch (e) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: e.message });
    }
});

// ===== تحميل الملف النهائي للمتصفح =====
app.get('/api/file/:name', (req, res) => {
    const fileName = req.params.name;
    const filePath = path.join(DOWNLOADS_DIR, fileName);

    if (fs.existsSync(filePath)) {
        res.download(filePath, fileName);
    } else {
        res.status(404).json({ error: 'الملف غير موجود أو تم حذفه' });
    }
});

// ===== تشغيل الواجهة المباشرة =====
app.use(express.static(__dirname));

// التعديل الخاص بـ Replit للتعرف على البورت المفتوح تلقائياً
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Fast Save Server running on port ${PORT}`);
});