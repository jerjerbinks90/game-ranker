export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'Method not allowed' };
  }

  const { updates, username } = JSON.parse(event.body);
  const password = process.env.BGG_PASSWORD;

  if (!password || !username) {
    return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: "Missing credentials" }) };
  }
  if (!updates || updates.length === 0) {
    return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: "No updates" }) };
  }

  // Step 1: Login to BGG
  let cookieString = '';
  try {
    const loginRes = await fetch('https://boardgamegeek.com/login/api/v1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentials: { username, password } }),
      redirect: 'manual',
    });

    // Extract cookies - try multiple methods
    let setCookies = [];
    if (loginRes.headers.getSetCookie) {
      setCookies = loginRes.headers.getSetCookie();
    } else {
      // Fallback: try raw headers
      const raw = loginRes.headers.get('set-cookie');
      if (raw) setCookies = raw.split(/,(?=\s*\w+=)/);
    }

    const validCookies = [];
    for (const cookie of setCookies) {
      const nameValue = cookie.split(';')[0].trim();
      const value = nameValue.split('=').slice(1).join('=');
      if (value === 'deleted' || value === '') continue;
      validCookies.push(nameValue);
    }
    cookieString = validCookies.join('; ');

    if (!cookieString.includes('bgg_username')) {
      return { statusCode: 401, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: `BGG login failed (status ${loginRes.status}, cookies: ${setCookies.length})` }) };
    }
  } catch (err) {
    return { statusCode: 502, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: "Login error: " + err.message }) };
  }

  // Step 2: Push ratings (max 10 per call to stay within timeout)
  const results = [];
  for (const { collid, objectid, rating } of updates.slice(0, 10)) {
    try {
      const res = await fetch(`https://boardgamegeek.com/api/collectionitem/${collid}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': cookieString,
        },
        body: JSON.stringify({
          item: {
            collid: String(collid),
            objecttype: 'thing',
            objectid: String(objectid),
            rating: rating,
          }
        }),
      });
      results.push({ collid, objectid, status: res.status, ok: res.status === 200 });
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      results.push({ collid, objectid, status: 0, ok: false, error: err.message });
    }
  }

  return {
    statusCode: 200,
    headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    body: JSON.stringify({ results, total: results.length, success: results.filter(r => r.ok).length }),
  };
};
