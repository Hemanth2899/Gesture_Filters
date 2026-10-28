# GestureAR Web

Browser-based adaptation of the supplied GestureAI/GestureAR Python desktop project. It uses the webcam, MediaPipe Tasks Vision in the browser, simple gesture heuristics, canvas-drawn face effects, and screenshot download.

## Run locally

Camera access is normally allowed on `localhost` or HTTPS. From this folder, start a static server, for example:

```bash
python -m http.server 8000
```

Open `http://localhost:8000` in Chrome or Edge, choose **Start camera**, and allow camera access. The first start needs an internet connection to load MediaPipe's browser library and model files.

## Deploy to GitHub Pages

1. Create a GitHub repository and upload the files in this folder (`index.html`, `style.css`, `app.js`, `README.md`).
2. Open repository **Settings → Pages**.
3. Choose **Deploy from a branch**, select `main` and `/ (root)`, then Save.
4. Open the Pages URL and allow camera access.

## Deploy to Vercel

1. Import the GitHub repository into Vercel, or deploy this folder using the Vercel CLI.
2. Use the project root as the root directory. No build command is needed; the output is the root directory.
3. Deploy, then open the HTTPS URL and allow camera access.

## Notes and limitations

- The original Python `main.py` is a desktop OpenCV app and cannot run unchanged as a static website. Keep it in your original repository if you want to retain the Python version.
- This web adaptation is not a line-for-line port. The browser version uses approximate landmark heuristics; gesture recognition may be less reliable than the Python implementation, and the heart effect is a visual effect rather than full two-hand heart-pose recognition.
- Camera frames are processed locally in the browser. The MediaPipe library and model files are loaded from public CDNs on first use, so an internet connection is required to start the AI models.
- Use HTTPS for hosted deployments. Webcam access requires user permission.
