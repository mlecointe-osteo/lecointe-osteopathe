/**
 * Netlify Function — GitHub OAuth Proxy for Decap CMS
 *
 * Compatible avec le protocole NetlifyAuthCodeFlow de Decap CMS :
 *  1) ?provider=github → redirige vers GitHub OAuth
 *  2) ?code=xxx        → échange le code contre un token, retourne une page
 *                        qui fait postMessage vers la fenêtre parente
 *
 * Variable d'environnement requise : GITHUB_CLIENT_SECRET
 */

const CLIENT_ID = 'Ov23libQVlWPy8QxnqLr';

export const handler = async (event) => {
  const params = event.queryStringParameters || {};
  const { provider, scope, code } = params;

  // Détermine l'URL de base (pour redirect_uri)
  const host = event.headers['x-forwarded-host'] || event.headers.host || '';
  const proto = event.headers['x-forwarded-proto'] || 'https';
  const baseUrl = `${proto}://${host}`;
  const redirectUri = `${baseUrl}/.netlify/functions/auth`;

  // ── Étape 1 : redirection vers GitHub ──────────────────────────────────────
  if (provider === 'github' && !code) {
    const authUrl = new URL('https://github.com/login/oauth/authorize');
    authUrl.searchParams.set('client_id', CLIENT_ID);
    authUrl.searchParams.set('scope', scope || 'repo');
    authUrl.searchParams.set('redirect_uri', redirectUri);

    return {
      statusCode: 302,
      headers: { Location: authUrl.toString() },
      body: '',
    };
  }

  // ── Étape 2 : échange du code contre un token ──────────────────────────────
  if (code) {
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;
    if (!clientSecret) {
      return errorPage('Configuration manquante : GITHUB_CLIENT_SECRET non défini.');
    }

    try {
      const resp = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });

      const data = await resp.json();

      if (data.error || !data.access_token) {
        return errorPage(data.error_description || data.error || 'Token exchange failed');
      }

      return successPage({ token: data.access_token }, baseUrl);
    } catch (err) {
      return errorPage(err.message);
    }
  }

  return { statusCode: 400, body: 'Requête invalide.' };
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function successPage(content, baseUrl) {
  const contentStr = JSON.stringify(content);
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Authentification GitHub</title></head>
<body>
<script>
(function () {
  var baseUrl = ${JSON.stringify(baseUrl)};
  var content = ${contentStr};
  var provider = 'github';

  function sendToken() {
    window.opener.postMessage(
      'authorization:' + provider + ':success:' + JSON.stringify(content),
      baseUrl
    );
    window.close();
  }

  // Protocole Decap CMS : handshake d'abord
  window.addEventListener('message', function (e) {
    if (e.origin === baseUrl && e.data === 'authorizing:' + provider) {
      sendToken();
    }
  });

  // Envoi du handshake initial
  if (window.opener) {
    window.opener.postMessage('authorizing:' + provider, baseUrl);
  } else {
    document.body.innerHTML = '<p>Authentifié. Vous pouvez fermer cette fenêtre.</p>';
  }
})();
</script>
<p>Authentification en cours…</p>
</body>
</html>`,
  };
}

function errorPage(message) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Erreur d'authentification</title></head>
<body>
<script>
(function () {
  if (window.opener) {
    window.opener.postMessage(
      'authorization:github:error:' + ${JSON.stringify(JSON.stringify(message))},
      '*'
    );
  }
  window.close();
})();
</script>
<p>Erreur : ${message}</p>
</body>
</html>`,
  };
}
