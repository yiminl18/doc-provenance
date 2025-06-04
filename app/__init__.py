from flask import Flask, jsonify
from flask_cors import CORS
import os

def create_app():
    app = Flask(__name__)
    CORS(app)  # Enable CORS for all routes
    
    app.config['SECRET_KEY'] = os.urandom(24).hex()
    app.config['UPLOAD_FOLDER'] = 'app/uploads'
    app.config['ALLOWED_EXTENSIONS'] = {'pdf'}
    app.config['PRELOAD_FOLDER'] = 'app/preloaded'
    app.config['LAYOUT_DIR'] = 'app/layouts'
    app.config['SENTENCES_DIR'] = 'app/sentences'
    app.config['DOWNLOAD_DIR'] = 'app/gdrive_downloads'
    app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16 MB limit for file uploads
    app.config['PROPAGATE_EXCEPTIONS'] = True  # Propagate exceptions to the WSGI server
    from app.routes import main
    app.register_blueprint(main, url_prefix='/api')

    return app 