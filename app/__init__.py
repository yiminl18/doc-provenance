from flask import Flask
from flask_cors import CORS
import os

def create_app():
    app = Flask(__name__)
    CORS(app)  # Enable CORS for all routes
    
    app.config['SECRET_KEY'] = os.urandom(24).hex()
    app.config['UPLOAD_FOLDER'] = 'app/uploads'
    app.config['ALLOWED_EXTENSIONS'] = {'pdf'}
    app.config['PRELOAD_FOLDER'] = 'app/preloaded'
    
    from app.routes import main
    app.register_blueprint(main, url_prefix='/api')
    
    return app 