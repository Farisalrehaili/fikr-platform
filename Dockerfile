# استضافة منصة تحصيلي بلس — يعمل على Railway / Render / أي سيرفر يدعم Docker
FROM node:22-alpine

WORKDIR /app

# نسخ ملفات المشروع
COPY package*.json ./
RUN npm install --omit=dev || true
COPY . .

# تخزين دائم: قاعدة البيانات والملفات تُحفظ في /data (يُربط بـ Volume على المنصة)
ENV TH_DATA=/data
ENV TH_UPLOADS=/data/uploads
ENV PORT=3000

EXPOSE 3000

CMD ["node", "server.js"]
