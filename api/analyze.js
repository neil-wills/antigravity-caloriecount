export default async function handler(req, res) {
  // CORS & Health check
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET request checks if server environment key is configured
  if (req.method === 'GET') {
    const isConfigured = !!process.env.GEMINI_API_KEY;
    return res.status(200).json({ 
      configured: isConfigured, 
      mode: isConfigured ? 'server_env' : 'none' 
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ 
      error: 'GEMINI_API_KEY environment variable is not configured on the server. Please enter a key in Settings or set GEMINI_API_KEY in your deployment environment.' 
    });
  }

  const { prompt, base64Data, mimeType } = req.body || {};
  if (!prompt || !base64Data) {
    return res.status(400).json({ error: 'Missing prompt or image base64 data' });
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const payload = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: mimeType || 'image/jpeg',
                data: base64Data
              }
            }
          ]
        }
      ],
      generationConfig: {
        responseMimeType: "application/json"
      }
    };

    const apiRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      return res.status(apiRes.status).json({ error: `Gemini API error: ${errText}` });
    }

    const data = await apiRes.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Gemini proxy error:', error);
    return res.status(500).json({ error: error.message || 'Internal proxy error' });
  }
}
