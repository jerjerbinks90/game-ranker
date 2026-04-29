export default async function handler(req, res) {
  const { username } = req.query;
  if (!username) return res.status(400).send("Missing username");

  const bggUrl = `https://boardgamegeek.com/xmlapi2/collection?username=${encodeURIComponent(username)}&excludesubtype=boardgameexpansion&brief=1`;

  for (let i = 0; i < 3; i++) {
    const response = await fetch(bggUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "application/xml"
      }
    });

    const xml = await response.text();

    if (xml && xml.trim().length > 0) {
      res.setHeader("Content-Type", "application/xml");
      res.setHeader("Access-Control-Allow-Origin", "*");
      return res.send(xml);
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  res.status(502).send("<error>BGG returned empty response after retries</error>");
}
