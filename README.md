Detaylı Moderasyon Botu (Discord Moderation Bot)
Discord sunucularınız için güçlü, detaylı ve özelleştirilebilir bir moderasyon botu. Moderasyon cezaları, uyarı sistemi, otomatik loglama, kayıt, ticket, çekiliş, coin sistemi, blacklist, davet takip, ses/toplantı modu ve yetkili başvuruları gibi geniş bir özellik yelpazesi sunar. Slash komutları ile modern, kullanıcı dostu bir deneyim sağlar.

Repo: https://github.com/prox0959/detayl-moderasyon-botu
Dil/Framework: Node.js (Discord.js v14)
Veritabanı: JSON tabanlı (örnek implementasyon) — kolayca SQLite/Postgres ile genişletilebilir
Komut Sistemi: Slash commands (Discord.js SlashCommandBuilder)

🚀 Özellikler
Temel Moderasyon: /ban, /unban, /kick, /mute (timeout), /unmute, mesaj temizleme (/temizle)
Uyarı Sistemi: /uyar, /cezalar (kullanıcının ceza geçmişi), warn limitleri/otomatik cezalar desteği (altyapı hazır)
Detaylı Loglama: moderasyon eylemleri, kayıt işlemleri, ses logları, yetkili bildirimleri için log kanalları; kolay entegrasyon için sendLog() yapısı
Kayıt Sistemi: /kayit (isim/yaş/cinsiyet, otomatik rol verme, kayıt log kanalı, kayıtsız/kayıtlı/erkek/kız rolleri)
Kurulum & Yönetim: /setup alt komutları ile log, ticket, kayıt, yetkili-log, ses-log, mute rolü, kayıt rolleri, mod rolü ayarları; /sistem ile sistemleri aç/kapat
Ticket Sistemi: /ticket-panel ile destek paneli, ticket oluşturma butonu (ticket_create), kategori kanalı ayarı
Çekiliş (Giveaway): /cekilis baslat, /cekilis ver (transfer), /coin ekle (admin); günlük ödül ve streak takibi
Blacklist: /blacklist ile yasaklı kelime/kullanıcı ekle/sil/liste; mesaj filtreleme altyapısına entegre edilebilir
Ses & Toplantı Modu: /ses rol-ayarla, /sesabanında invites` yapısı mevcut)
Yetkili Başvuruları: /basvuru ile modal tabanlı başvuru formu; başvurular applications koleksiyonunda tutulur
Bilgi Komutları: /sunucu, /kullanici, /ping, /yardim
Rol & Kanal Yardımcıları: /rol ver/al, /yavaslat, /kilit
İstatistikler: /stats ile mesaj/ses/coin/davet/ceza ve yetkili istatistikleri
📦 Gereksinimler
Node.js v16+ (önerilir)
Discord.js v14
Discord bot token (Discord Developer Portal)
(Opsiyonel) Daha stabil veri saklama için SQLite/Postgres (mevcut yapı JSON tabanlıdır; genişletmesi kolaydır)
Bağımlılıklar (örnek):

discord.js
ms (süre stringlerini milisaniyeye çevirme)
fs (Node.js built-in)
Proje kökünde package.json oluşturmanız önerilir. Örnek package.json en altta verilmiştir.

⚙️ Kurulum
1) Repoyu klonlayın
Bash

git clone https://github.com/prox0959/detayl-moderasyon-botu.git
cd detayl-moderasyon-botu
2) Bağımlılıkları yükleyin
Bash

npm install discord.js ms
3) Yapılandırma dosyası oluşturun
Bot, commands.js içinde idını okuyarak ortam değişkenlerine (process.env) yükler. Proje köküne **id.json`** dosyası oluşturun:

id.json (örnek):

JSON

{
  "DISCORD_TOKEN": "YOUR_DISCORD_BOT_TOKEN",
  "PREFIX": "!",
  "OWNERS": ["YOUR_DISCORD_ID"],
  "LOG_CHANNEL_ID": "DEFAULT_LOG_CHANNEL_ID",
  "DAILY_COIN": 100
}
Güvenlik için id.json/.env dosyasını .gitignore’a ekleyin. İsterseniz id.json yerine .env kullanacak şekilde kodu güncelleyebilirsiniz.

4) Ana bot dosyasını oluşturun (index.js)
commands.js sadece slash komut tanımlarını içerir; botun çalışması için bir giriş noktası gerekir. Aşağıda, sağlanan initCommands fonksiyonunu kullanan tipik bir index.js örneği yer alıyor:

index.js (örnek iskelet):

JavaScript

import { Client, GatewayIntentBits, Collection, Events } from 'discord.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { commands, initCommands, endGiveaway } from './commands.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(__dirname, 'id.json'), 'utf-8'));
Object.entries(cfg).forEach(([k,v]) => process.env[k] = String(v));

// Basit JSON veritabanı; prod için SQLite/Postgres önerilir
const DB_PATH = join(__dirname, 'data', 'db.json');
if (!existsSync(join(__dirname, 'data'))) fs.mkdirSync(join(__dirname, 'data'));
const db = existsSync(DB_PATH) ? JSON.parse(readFileSync(DB_PATH, 'utf-8')) : {
  guilds: {}, users: {}, blacklist: [], invites: {}, giveaways: {}, applications: {}
};
function saveDB() { writeFileSync(DB_PATH, JSON.stringify(db, null, 2)); }

// Yardımcılar
function getGuild(guildId) {
  if (!db.guilds[guildId]) db.guilds[guildId] = {
    channels: { log: null, ticket: null, kayit: null, yetkiliLog: null, sesLog: null },
    roles: { mute: null, unregistered: null, kayitli: null, erkek: null, kadin: null, mod: null, sesRol: null },
    systems: { ticket: false, kayit: false, antiSpam: false, blacklist: false, davet: false, coin: false, ses: false, meeting: false }
  };
  return db.guilds[guildId];
}
function getUser(userId, guildId) {
  if (!db.users[userId]) db.users[userId] = {
    coin: 0, totalCoin: 0, daily: { lastClaim: 0, streak: 0 },
    stats: { messages: 0, voiceMinutes: 0, invites: 0 },
    punishments: [],
    staffStats: { kayits: 0, kicks: 0, bans: 0, mutes: 0, warns: 0, tickets: 0 }
  };
  return db.users[userId];
}
async function addLog(entry) {
  // İsteğe bağlı: log dosyası/kanal. Burada sadece konsola yazdırabilirsiniz.
  console.log('[LOG]', entry);
}

// Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildInvites,
  ]
});

client.commands = new Collection();
for (const cmd of commands) {
  client.commands.set(cmd.data.name, cmd);
}

// Komutları bağla
initCommands(db, saveDB, addLog, getGuild, getUser);

// Slash komutları kaydet (opsiyonel ama önerilir; global veya guild bazlı)
client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}`);
  // Global kayıt (prod için önerilir; gelişme sırasında guild bazlı daha hızlıdır)
  await client.application.commands.set(commands.map(c => c.data));
});

// Interaction handler
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const cmd = client.commands.get(interaction.commandName);
    if (!cmd) return;
    try {
      await cmd.execute(interaction, client);
    } catch (err) {
      console.error(err);
      const reply = { content: 'Komut çalıştırılırken bir hata oluştu.', ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.editReply(reply).catch(() => {});
      else await interaction.reply(reply).catch(() => {});
    }
    return;
  }

  // Button / Modal handler örnekleri (ticket, giveaway join, basvuru modal submit)
  if (interaction.isButton()) {
    if (interaction.customId === 'ticket_create') {
      const guildCfg = getGuild(interaction.guildId);
      if (!guildCfg.systems.ticket || !guildCfg.channels.ticket) return interaction.reply({ content: 'Ticket sistemi kapalı veya kategori ayarlanmamış.', ephemeral: true });
      // Burada ticket kanal oluşturma mantığı ekleyin (kategori, izinler, ticket_log vb.)
      return interaction.reply({ content: 'Ticket oluşturuldu (mantık eklenmeli).', ephemeral: true });
    }
    if (interaction.customId === 'giveaway_join') {
      const g = db.giveaways[interaction.message.id];
      if (!g || g.ended) return interaction.reply({ content: 'Bu çekiliş sona erdi.', ephemeral: true });
      const uid = interaction.user.id;
      if (g.participants.includes(uid)) {
        g.participants = g.participants.filter(id => id !== uid);
        await saveDB();
        return interaction.reply({ content: 'Çekilişten ayrıldınız.', ephemeral: true });
      }
      g.participants.push(uid);
      await saveDB();
      return interaction.reply({ content: 'Çekilişe katıldınız!', ephemeral: true });
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId === 'basvuru_modal') {
      const key = `${interaction.guildId}_${interaction.user.id}`;
      const yas = interaction.fields.getTextInputValue('yas');
      const tecrube = interaction.fields.getTextInputValue('tecrube');
      const neden = interaction.fields.getTextInputValue('neden');
      const zaman = interaction.fields.getTextInputValue('zaman');
      const ekstra = interaction.fields.getTextInputValue('ekstra') || '';
      db.applications[key] = {
        userId: interaction.user.id, guildId: interaction.guildId,
        yas, tecrube, neden, zaman, ekstra, status: 'pending', submittedAt: Date.now()
      };
      await saveDB();
      const guildCfg = getGuild(interaction.guildId);
      const yetkiliLog = guildCfg.channels.yetkiliLog;
      if (yetkiliLog) {
        const ch = interaction.guild.channels.cache.get(yetkiliLog);
        if (ch) await ch.send({ content: `Yeni yetkili başvurusu: <@${interaction.user.id}>\nYaş: ${yas}\nTecrübe: ${tecrube}\nNeden: ${neden}\nZaman: ${zaman}\nEkstra: ${ekstra}` });
      }
      return interaction.reply({ content: 'Başvurunuz alındı. Değerlendirme sonrası dönüş yapılacaktır.', ephemeral: true });
    }
  }
});

// Botu başlat
client.login(process.env.DISCORD_TOKEN);
5) Botu başlatın
Bash

node index.js
🔑 Discord Developer Portal Ayarları
Discord Developer Portal → New Application
Bot sekmesi → Add Bot
Privileged Gateway Intents: Server Members, Message Content (gerekirse) etkinleştirin
OAuth2 → URL Generator: bot + applications.commands izinleriyle davet linki oluşturun ve sunucunuza ekleyin
Botun sunucuda yetkileri olduğundan emin olun: Manage Roles, Kick Members, Ban Members, Moderate Members, View Channels, Send Messages, Manage Messages, Manage Channels, Manage Guild vb.
🧭 Komutlar (Özet)
Kategori	Komutlar
Moderasyon	/ban, /unban, /kick, /mute, /unmute, /uyar, /cezalar, /temizle
Kayıt	/kayit
Kurulum	/setup (log, ticket, kayıt, yetkili-log, ses-log, mute-rol, kayitsiz-rol, kayıtli-rol, erkek-rol, kadin-rol, mod-rol, bilgi), /sistem
İstatistik	/stats, /coin, /davet, /sunucu, /kullanici
Ticket	/ticket-panel
Ses	/ses (rol-ayarla, toplanti-ac, toplanti-kapat, bilgi)
Çekiliş	/cekilis baslat, /cekilis bitis, /cekilis liste
Blacklist	/blacklist (ekle-kelime/sil-kelime, ekle-kullanici/sil-kullanici, liste)
Yetkili	/basvuru
Yardımcı	/rol, /yavaslat, /kilit, /ping, /yardim
🗂️ Önerilen Proje Yapısı
text

detayl-moderasyon-botu/
├── data/
│   └── db.json           # JSON veritabanı (opsiyonel)
├── logs/                 # opsiyonel log dosyaları
├── commands.js
├── index.js              # bot giriş noktası
├── id.json               # token/ayarlar (gitignore)
├── package.json
├── README.md
└── .gitignore
🛡️ Güvenlik & İyi Uygulamalar
Token’ı asla repoya yüklemeyin: id.json veya .env dosyasını .gitignore’a ekleyin.
Yetkileri minimum gerekli düzeyde verin; her sunucu için farklı kurulum kullanın.
Moderasyon eylemlerini loglayın; komut erişimini rol/channel bazlı sınırlandırın.
Spam/kelime filtrelerini dikkatli ayarlayın; yanlış pozitifleri azaltmak için whitelist/istisnalar ekleyin.
Prod ortamında JSON yerine SQLite/Postgres gibi kalıcı ve daha güvenli bir DB kullanın.
🚢 Deployment (Yayınlama)
Popüler seçenekler: Railway, Render, Fly.io, VPS (Ubuntu + pm2/systemd), Docker.
Docker kullanıyorsanız Dockerfile ve docker-compose.yml eklemek iyi bir pratiktir.

🤝 Katkıda Bulunma
Fork edin ve yeni bir branch oluşturun (feature/xyz)
Değişiklikleri yapın ve test edin
Pull Request açın; açıklayıcı başlık ve detaylı açıklama ekleyin
📄 Lisans
Bu repo genellikle bir lisans içerir. LICENSE dosyası varsa burada belirtin; yoksa varsayılan olarak MIT ekleyebilirsiniz.

📞 İletişim
Geliştirici: prox0959 — https://github.com/prox0959
Sorular için Issue açabilir veya Discord üzerinden ulaşabilirsiniz.
