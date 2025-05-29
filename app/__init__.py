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
    
    from app.routes import main
    app.register_blueprint(main, url_prefix='/api')

    # Add this debug route to check your configuration
    @app.route('/debug/config')
    def debug_config():
        return jsonify({
            'current_working_dir': os.getcwd(),
            'upload_folder': app.config.get('UPLOAD_FOLDER'),
            'preload_folder': app.config.get('PRELOAD_FOLDER'),
            'upload_folder_exists': os.path.exists(app.config.get('UPLOAD_FOLDER', '')),
            'preload_folder_exists': os.path.exists(app.config.get('PRELOAD_FOLDER', '')),
            'upload_folder_contents': os.listdir(app.config['UPLOAD_FOLDER']) if os.path.exists(app.config.get('UPLOAD_FOLDER', '')) else [],
            'preload_folder_contents': os.listdir(app.config['PRELOAD_FOLDER']) if os.path.exists(app.config.get('PRELOAD_FOLDER', '')) else []
        })
    
    return app 