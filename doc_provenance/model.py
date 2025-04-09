import os, sys
sys.path.append(os.path.abspath(os.path.dirname(__file__)))

from models.gpt_4o import gpt_4o 
from models.gpt_4o_mini import gpt_4o_mini
from models.gpt_4_vision import gpt_4o_vision
from models.gemeni_2 import gemini_2_flash

#this is the models API. You pass the model (name of the model) and prompt, the API will return the response out 
def model(model_name, prompt, image_path = ''):
    if(model_name == 'gpt4o'):
        return gpt_4o(prompt)
    if(model_name == 'gpt4vision'):
        return gpt_4o_vision(image_path,prompt)
    if(model_name == 'gpt4omini'):
        return gpt_4o_mini(prompt)
    if(model_name == 'gemini2flash'):
        return gemini_2_flash(prompt)
    return 'input model does not exist'


