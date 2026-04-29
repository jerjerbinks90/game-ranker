export const handler = async (event) => {
  const username = event.queryStringParameters?.username;
  if (!username) {
    return { statusCode: 400, body: "Missing username" };
  }

  const bggUrl = `https://boardgamegeek.com/xmlapi2/collection?username=${encodeURIComponent(username)}&excludesubtype=boardgameexpansion&brief=1&minplays=1`;

  for (let i = 0; i < 3; i++) {
    try {
      const response = await fetch(bggUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "application/xml"
        }
      });

      const xml = await response.text();

      if (xml && xml.trim().length > 0) {
        return {
          statusCode: 200,
          headers: {
            "Content-Type": "application/xml",
            "Access-Control-Allow-Origin": "*"
          },
          body: xml
        };
      }
    } catch (e) {
      // retry
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  return { statusCode: 502, body: "<e>BGG returned empty response after retries</e>" };
};
