const express = require('express');
const admin = require('firebase-admin');
const cron = require('node-cron');
require('dotenv').config();
const moment = require('moment-timezone'); // Import moment-timezone

// Inisialisasi Express
const app = express();
const PORT = process.env.PORT || 3000;

// Inisialisasi Firebase Admin SDK
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://presensi-fb629-default-rtdb.firebaseio.com/",
});

// Fungsi untuk mengirim notifikasi ke satu perangkat dengan gambar
async function sendNotification(fcmToken, agendaName, place, imageUrl) {
  const message = {
    notification: {
      title: `Peringatan: ${agendaName}`,
      body: `Agenda akan dimulai dalam beberapa menit di ${place}!`,
    },
    android: {
      notification: {
        imageUrl: imageUrl, // Menambahkan gambar pada notifikasi Android
      }
    },
    token: fcmToken,
  };

  try {
    const response = await admin.messaging().send(message);
    console.log("Notifikasi berhasil dikirim:", response);
  } catch (error) {
    console.error("Gagal mengirim notifikasi:", error);
  }
}

// Fungsi untuk mengambil hingga 5 FCM Tokens dari data users
async function getUserFCMToken(username) {
  try {
    const userRef = admin.database().ref(`users/${username}`);
    const userSnapshot = await userRef.once('value');
    const fcmTokens = userSnapshot.child('fcmTokens').val();

    if (Array.isArray(fcmTokens) && fcmTokens.length > 0) {
      console.log(`FCM Tokens untuk pengguna ${username}:`, fcmTokens); // Cek tokens yang diambil
      return fcmTokens.slice(0, 5); // Mengambil maksimal 5 token
    }

    console.log(`Tidak ada FCM Tokens untuk pengguna ${username}`);
    return [];
  } catch (error) {
    console.error(`Gagal mengambil FCM Tokens untuk pengguna ${username}:`, error);
    return [];
  }
}

// Fungsi untuk memeriksa agenda dan mengirim notifikasi
async function checkAgendaAndSendNotification() {
  console.log("Memeriksa agenda untuk pengiriman notifikasi...");

  const now = moment().tz("Asia/Jakarta");  // Menggunakan waktu WIB
  const agendaRef = admin.database().ref("/agenda");

  // Mengambil data agenda sekaligus
  const agendaSnapshot = await agendaRef.once("value");

  // Iterasi menggunakan for...of untuk memastikan proses async berjalan sesuai urutan
  for (const [agendaId, agenda] of Object.entries(agendaSnapshot.val() || {})) {
    const agendaTime = moment(agenda.tanggal_agenda).tz("Asia/Jakarta");  // Konversi agenda time ke WIB
    const reminder10MinTime = agendaTime.clone().subtract(10, 'minutes');
    const reminder5MinTime = agendaTime.clone().subtract(5, 'minutes');

    console.log(`Memeriksa agenda dengan ID: ${agendaId}`);
    console.log(`Agenda time: ${agendaTime.format()}, now: ${now.format()}`);
    console.log(`Reminder 10 minutes time: ${reminder10MinTime.format()}, Reminder 5 minutes time: ${reminder5MinTime.format()}`);

    // Kirim notifikasi 10 menit sebelum agenda jika belum dikirim
    if (!agenda.notified_10min && now.isSameOrAfter(reminder10MinTime) && now.isBefore(reminder5MinTime)) {
      await sendAgendaNotifications(agenda, agendaId);
      await agendaRef.child(`${agendaId}/notified_10min`).set(true);
      console.log(`Notifikasi 10 menit sebelum agenda '${agenda.nama_agenda}' telah dikirim.`);
    }

    // Kirim notifikasi 5 menit sebelum agenda jika belum dikirim
    if (!agenda.notified_5min && now.isSameOrAfter(reminder5MinTime) && now.isBefore(agendaTime)) {
      await sendAgendaNotifications(agenda, agendaId);
      await agendaRef.child(`${agendaId}/notified_5min`).set(true);
      console.log(`Notifikasi 5 menit sebelum agenda '${agenda.nama_agenda}' telah dikirim.`);
    }

    // Jika agenda sudah lewat, pastikan statusnya diperbarui (opsional)
    if (now.isAfter(agendaTime) && !agenda.notified_10min) {
      console.log(`Agenda '${agenda.nama_agenda}' sudah lewat waktunya.`);
    }
  }

  console.log("Semua agenda telah diperiksa dan notifikasi telah dikirim jika perlu.");
}

// Fungsi untuk mengirim notifikasi ke admin dan anggota agenda
async function sendAgendaNotifications(agenda, _agendaId) {
  const adminList = agenda.admins || [];
  const anggotaList = agenda.anggota || {};

  // URL gambar yang ingin Anda tampilkan di notifikasi (ganti dengan URL gambar yang sesuai)
  const imageUrl = "https://imgur.com/a/3VgrZYj";

  // Mengirim notifikasi ke setiap admin
  for (const adminUsername of adminList) {
    const fcmTokens = await getUserFCMToken(adminUsername);
    for (const token of fcmTokens) {
      await sendNotification(token, agenda.nama_agenda, agenda.tempat_agenda, imageUrl);
    }
  }

  // Mengirim notifikasi ke setiap anggota
  for (const anggotaUsername in anggotaList) {
    const fcmTokens = await getUserFCMToken(anggotaUsername);
    for (const token of fcmTokens) {
      await sendNotification(token, agenda.nama_agenda, agenda.tempat_agenda, imageUrl);
    }
  }
}

// Set cron job untuk mengecek agenda setiap 1 menit
cron.schedule("* * * * *", async () => {
  console.log("Cron job dijalankan...");
  await checkAgendaAndSendNotification();
});

// Route default
app.get('/', (req, res) => {
  res.send('Server is running');
});

// Jalankan server
app.listen(PORT, () => {
  console.log(`Server berjalan di port ${PORT}`);
});
