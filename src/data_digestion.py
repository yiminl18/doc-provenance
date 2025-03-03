import json, os, sys

current_file_directory = os.path.dirname(os.path.abspath(__file__))
parent_directory = os.path.dirname(current_file_directory)
sys.path.append(current_file_directory)
from model import model #[gpt4o, gpt4vision, gpt4omini]
model_name = 'gpt4omini'

def write_json(data, file_path):
    with open(file_path, "w") as file:
        json.dump(data, file, indent=4)

def digest_paper_dataset(file_path):
    paper_data = []
    with open(file_path, "r", encoding="utf-8") as file:
        data = json.load(file)  # Load entire JSON file
    for doi, details in data.items():
        o = {}
        o['title'] = details['title']
        o['text'] = details['text']
        if(len(o['text']) == 0):
            continue
        qas = []
        for q in details['questions']:
            qa = {}
            if(q['question'] == 'What is this paper about?'):
                continue
            qa['question'] = q['question']
            qa['answer'] = q['answer']
            qas.append(qa)
        o['question_answer'] = qas
        paper_data.append(o)
    return paper_data

def digest_hotpotQA_dataset(file_path):
    hotpots = []
    with open(file_path, "r", encoding="utf-8") as file:
        data = json.load(file)  # Load entire JSON file
    entries = data['entries']
    i = 0
    for entry in entries:
        hotpot = {}
        context = ''
        for c in entry['context']:
            content = ''.join(c[1])
            context += content 
        hotpot['question'] = entry['question']
        hotpot['answer'] = entry['answer']
        hotpot['document_name'] = entry['document_name']
        hotpot['context'] = context
        hotpots.append(hotpot)
    return hotpots 

def add_instructions(hotpots):
    prompt = "Generate an instruction based on the given question and answer to specify how the output should be formatted. For example: If the answer is 'yes' or 'no,' the instruction should be: 'Only return yes or no. Do not add explanations.'If the answer is a single phrase, the instruction should be: 'Only return the answer. Do not add explanations.'If the answer is a list of phrases, the instruction should be: 'Return a list of phrases.'"


    for e in hotpots:
        question = e['question']
        answer = e['answer']
        context = 'This is the question: ' + question + ' This is the answer: ' + answer
        instruction = model(model_name, (prompt, context))
        print(question, answer)
        print(instruction)
        e['instruction'] = instruction
    
    write_json(hotpots, parent_directory + '/data/hotpotQA_fullwiki.json')

def sample_paper_questions():
    questions = []
    questions.append(('In what year was this paper published?','Return only a number. Do not add explanations.'))
    questions.append(('Who are the authors of this paper?','Return only a list of strings, seperated by |'))
    questions.append(('In which conference was this paper published?', 'Return only the conference name. '))

    return questions
    


if __name__ == "__main__":
    paper_data_path = parent_directory + '/data/papers.json'
    #paper_data = digest_paper_dataset(paper_data_path)
    # for i in range(3):
    #     o = paper_data[i]
    #     print(o['title'])
    #     #print(o['text'][:10])
    #     for i in range(3):
    #         print(o['question_answer'][i])
    hotpot_data_path = parent_directory + '/data/hotpotQA_hotpot_dev_fullwiki_v1.json'
    hotpots = digest_hotpotQA_dataset(hotpot_data_path)
    add_instructions(hotpots)

        

