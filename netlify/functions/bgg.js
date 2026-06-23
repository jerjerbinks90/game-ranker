export const handler = async (event) => {
  const username = event.queryStringParameters?.username;
  if (!username) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing username" }) };
  }

  const token = process.env.BGG_API_TOKEN;
  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ error: "BGG API token not configured" }) };
  }

  const bggUrl = `https://boardgamegeek.com/xmlapi2/collection?username=${encodeURIComponent(username)}&excludesubtype=boardgameexpansion&stats=1&minplays=1`;

  try {
    const response = await fetch(bggUrl, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/xml"
      }
    });

    const body = await response.text();

    return {
      statusCode: response.status,
      headers: {
        "Content-Type": response.status === 200 ? "application/xml" : "text/plain",
        "Access-Control-Allow-Origin": "*"
      },
      body: body
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: "Failed to reach BGG: " + err.message })
    };
  }
};
