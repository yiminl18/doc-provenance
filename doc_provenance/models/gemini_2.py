from google.generativeai import GenerativeModel
import google.generativeai as genai
import os
from pathlib import Path

# reads gemini's api key from folder in the home directory named 'api_keys'
def read_api_key(filename="gemini2flash.txt", api_key_folder = '/Users/yiminglin/Documents/Codebase/api_keys/'):
    return "AIzaSyDkmvPP4MWfdv6Tt6r5xZgmE5UHiNE4Ndw"

api_key = read_api_key()
genai.configure(api_key=api_key)

def gemini_api(message_content, temperature=0):
    """
    
    Args:
        message_content (str): the prompt + content of document
        temperature (float, optional): for randomness, default to 0 for now
    
    Returns:
        str: model response text, aka the provenance
    """
    model = GenerativeModel(model_name="gemini-2.0-flash")
    response = model.generate_content(
        message_content,
        generation_config={"temperature": temperature}
    )
    return response.text

def gemini_2_flash(prompt):
    message_content = prompt[0] + prompt[1]
    return gemini_api(message_content)