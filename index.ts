import 'dotenv/config';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const TelegramBot = require('node-telegram-bot-api');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error('Chyba: Chybi pozadovane promenne prostredi pro Telegram (.env)!');
  process.exit(1);
}

// Inicializace Telegram bota s long-pollingem pro prijem prikazu
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

const BASE_INTERVAL_MS = 5 * 60 * 1000; // 5 minut
const MAX_JITTER_MS = 60 * 1000; // 0 az 60 sekund
const DAYS_TO_CHECK = 31; // Počet dní dopredu (aktuálně do půlky září)

// Konstanty zjistene z Cinema City
const TENANT_ID = '10101';
const CINEMA_ID = '1052'; // Praha Flora
const FILM_ID = '7268s2r'; // Odyssea
const TARGET_ATTR = '70-mm'; // IMAX 70mm

const knownEventIds = new Set<string>();
let isFirstRun = true;
let lastKnownEvents: Record<string, string[]> = {};
let nextCheckTimeMs = 0;

// Naslouchání příkazu /test
bot.onText(/^\/test/, (msg: any) => {
  if (msg.chat.id.toString() !== TELEGRAM_CHAT_ID) return;
  bot.sendMessage(msg.chat.id, 'ONLINE');
});

// Naslouchání příkazu /release
bot.onText(/^\/release(d)?/, (msg: any) => {
  if (msg.chat.id.toString() !== TELEGRAM_CHAT_ID) return;
  const dates = Object.keys(lastKnownEvents).sort();
  if (dates.length === 0) {
    bot.sendMessage(msg.chat.id, 'Zadne terminy zatim nenalezeny.');
    return;
  }
  let parts = [];
  for (const date of dates) {
    const [y, m, d] = date.split('-');
    const euDate = `${parseInt(d)}.${parseInt(m)}.`;
    const count = lastKnownEvents[date].length;
    parts.push(`${euDate}: ${count}x`);
  }
  bot.sendMessage(msg.chat.id, `Available: ${parts.join(', ')}`);
});

// Naslouchání příkazu /time
bot.onText(/^\/time/, (msg: any) => {
  if (msg.chat.id.toString() !== TELEGRAM_CHAT_ID) return;
  if (!nextCheckTimeMs) {
    bot.sendMessage(msg.chat.id, 'Kontrola ještě nezačala.');
    return;
  }
  const diffSec = Math.floor((nextCheckTimeMs - Date.now()) / 1000);
  if (diffSec < 0) {
    bot.sendMessage(msg.chat.id, 'Kontrola právě probíhá.');
  } else {
    const min = Math.floor(diffSec / 60);
    const sec = diffSec % 60;
    bot.sendMessage(msg.chat.id, `${min}m ${sec}s`);
  }
});

async function sendTelegramNotification(message: string): Promise<void> {
  try {
    await bot.sendMessage(TELEGRAM_CHAT_ID as string, message, { disable_web_page_preview: true });
    console.log('Telegram notifikace byla uspesne odeslana.');
  } catch (error) {
    console.error('Chyba pri komunikaci s Telegram API:', error);
  }
}

function getDatesToCheck(days: number): string[] {
  const dates: string[] = [];
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

async function checkAvailability(): Promise<void> {
  const now = new Date().toISOString();
  console.log(`[${now}] Provadim kontrolu dostupnosti vstupenek na film Odyssea (IMAX 70mm)...`);

  const dates = getDatesToCheck(DAYS_TO_CHECK);
  const newEventsByDate: Record<string, string[]> = {};
  const currentAvailableEvents: Record<string, string[]> = {};
  let foundNewEvents = false;

  try {
    for (const date of dates) {
      if (date.startsWith('2026-08')) {
        continue;
      }

      const url = `https://www.cinemacity.cz/cz/data-api-service/v1/quickbook/${TENANT_ID}/film-events/in-cinema/${CINEMA_ID}/at-date/${date}?attr=&lang=cs_CZ`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        console.error(`HTTP chyba pro datum ${date}, status: ${response.status}`);
        continue;
      }

      const data = (await response.json()) as any;
      const events = data?.body?.events || [];

      const targetEvents = events.filter(
        (e: any) =>
          e.filmId === FILM_ID &&
          Array.isArray(e.attributeIds) &&
          e.attributeIds.includes(TARGET_ATTR) &&
          e.soldOut === false &&
          (e.compositeBookingLink == null || e.compositeBookingLink.blockOnlineSales === false)
      );

      for (const event of targetEvents) {
        const timeMatch = event.eventDateTime?.match(/T(\d{2}:\d{2})/);
        const timeString = timeMatch ? timeMatch[1] : event.eventDateTime;

        if (!currentAvailableEvents[date]) {
          currentAvailableEvents[date] = [];
        }
        currentAvailableEvents[date].push(timeString);

        if (!knownEventIds.has(event.id)) {
          knownEventIds.add(event.id);

          if (!isFirstRun) {
            foundNewEvents = true;
            if (!newEventsByDate[date]) {
              newEventsByDate[date] = [];
            }
            newEventsByDate[date].push(timeString);
          }
        }
      }

      // Pauza mezi pozadavky pro prevenci rate limitu
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Aktualizace globálního stavu pro prikaz /released
    lastKnownEvents = currentAvailableEvents;

    if (foundNewEvents) {
      let message = '🚨 *Hlidac kin: Nove vypsane terminy na film Odyssea (IMAX 70mm)!* 🚨\n\n';

      for (const [date, times] of Object.entries(newEventsByDate)) {
        times.sort();
        const [y, m, d] = date.split('-');
        const euDate = `${parseInt(d)}. ${parseInt(m)}. ${y}`;
        message += `Datum ${euDate}: ${times.join(', ')}\n`;
      }

      message += '\n🔗 Odkaz k nakupu: https://www.cinemacity.cz/films/odyssea/7268s2r#/buy-tickets-by-film?in-cinema=prague&at=2026-08-18&for-movie=7268s2r&filtered=70-mm&view-mode=list';

      await sendTelegramNotification(message);
    } else {
      console.log(`[${now}] Zadne nove terminy nenalezeny.`);
    }
  } catch (error) {
    console.error(`[${now}] Chyba pri kontrole kina:`, error);
  } finally {
    isFirstRun = false;
    scheduleNextCheck();
  }
}

function scheduleNextCheck(): void {
  const jitter = Math.floor(Math.random() * MAX_JITTER_MS);
  const nextInterval = BASE_INTERVAL_MS + jitter;
  const nextIntervalSec = (nextInterval / 1000).toFixed(1);

  nextCheckTimeMs = Date.now() + nextInterval;

  console.log(`Dalsi kontrola probehne za ${nextIntervalSec} s.\n`);
  setTimeout(checkAvailability, nextInterval);
}

console.log('Spoustim cinema-watchdog s interaktivnim botem...');
checkAvailability();