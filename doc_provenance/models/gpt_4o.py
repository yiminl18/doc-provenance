from openai import OpenAI
import openai
import os 
from dotenv import dotenv_values
# Load environment variables from .env file
env_config = dotenv_values(".env")



# Access the API key from the environment variable
api_key = env_config['OPENAI_API_KEY']#os.getenv('OPENAI_API_KEY')
# Set the OpenAI API key
client = OpenAI(api_key=api_key)


def chatGPT_api(message_content,temperature=0):
    ##message_content is string
    response = client.chat.completions.create(model = "gpt-4o",
        messages = [
            {"role": "user", "content": message_content}],
        temperature = 0)

    return response.choices[0].message.content
    #return response["choices"][0]["message"]["content"]

def gpt_4o(prompt):
    message_content = prompt[0] + prompt[1]
    return chatGPT_api(message_content)
