const axios = require("axios");
const cheerio = require("cheerio");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${TOKEN}`;

class AdultScraper {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  async getHTML(url) {
    const { data } = await axios.get(url, {
      headers: { "User-Agent": "Magic Browser" },
    });
    return cheerio.load(data);
  }

  async extractVideoMetadata(url) {
    const $ = await this.getHTML(url);
    const jsonLdText = $('script[type="application/ld+json"]').html();
    if (!jsonLdText) throw new Error("No metadata found");

    const data = JSON.parse(jsonLdText);

    return {
      name: data.name || "No title",
      description: (data.description || "").trim(),
      uploadDate: data.uploadDate || "Unknown",
      thumbnail: Array.isArray(data.thumbnailUrl) ? data.thumbnailUrl[0] : data.thumbnailUrl,
      contentUrl: data.contentUrl || url,
    };
  }

  async getVideoLinks(search, amount = 3) {
    const url = `https://www.xvideos.com/?k=${encodeURIComponent(search)}&top`;
    const $ = await this.getHTML(url);

    const thumbs = $("div.mozaique.cust-nb-cols div.thumb").toArray();

    // shuffle
    for (let i = thumbs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [thumbs[i], thumbs[j]] = [thumbs[j], thumbs[i]];
    }

    const links = [];
    for (const thumb of thumbs) {
      if (links.length >= amount) break;
      const href = $(thumb).find("a").attr("href");
      if (href) links.push(this.baseUrl + href);
    }

    return links;
  }
}

const scraper = new AdultScraper("https://www.xvideos.com");

async function sendMessage(chat_id, text, extra = {}) {
  return axios.post(`${TELEGRAM_API}/sendMessage`, {
    chat_id,
    text,
    parse_mode: "Markdown",
    ...extra,
  });
}

async function sendPhoto(chat_id, photoUrl, caption) {
  return axios.post(`${TELEGRAM_API}/sendPhoto`, {
    chat_id,
    photo: photoUrl,
    caption,
    parse_mode: "Markdown",
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const update = req.body;
  if (!update.message || !update.message.text) {
    return res.status(200).send("No message text");
  }

  const chatId = update.message.chat.id;
  const text = update.message.text.trim();

  try {
    if (text.startsWith("/start")) {
      await sendMessage(
        chatId,
        "Welcome! Use /search <query> to find videos.\nExample: /search cats"
      );
    } else if (text.startsWith("/search")) {
      const query = text.split(" ").slice(1).join(" ");
      if (!query) {
        return sendMessage(chatId, "Please provide a search term after /search.");
      }

      await sendMessage(chatId, `Searching for videos: "${query}"...`);

      const links = await scraper.getVideoLinks(query, 3);
      if (links.length === 0) {
        return sendMessage(chatId, "No videos found for your query.");
      }

      for (const link of links) {
        try {
          const meta = await scraper.extractVideoMetadata(link);
          const message = `*${meta.name}*\n\n${meta.description}\n\nUploaded: ${meta.uploadDate}\n\n[Watch Video](${link})`;
          await sendPhoto(chatId, meta.thumbnail, message);
        } catch (err) {
          await sendMessage(chatId, `Error extracting metadata for ${link}`);
        }
      }
    } else {
      await sendMessage(chatId, "Unknown command. Try /search <query>");
    }
  } catch (error) {
    console.error(error);
    await sendMessage(chatId, "An error occurred processing your request.");
  }

  res.status(200).send("OK");
};
