import json, os, sys
current_file_directory = os.path.dirname(os.path.abspath(__file__))
parent_directory = os.path.dirname(current_file_directory)
sys.path.append(current_file_directory)
from model import model #[gpt4o, gpt4vision, gpt4omini]
model_name = 'gpt4omini'

def write_json(data, file_path):
    with open(file_path, "w") as file:
        json.dump(data, file, indent=4)

# def sample_qasper_paper_questions(file_path):
#     paper_data = []
#     with open(file_path, "r", encoding="utf-8") as file:
#         data = json.load(file)  # Load entire JSON file
#     i = 0
#     for d in data:
#         o = {}
#         questions = d['question_info']['question']
#         instruction = 'Only return answers. Do not add explanations. If answers are not found in the given context, return NULL. Context: '
#         question_id = 0
#         for qid in range(len(questions)):
#             q = questions[qid]
#             question = (q, instruction)
#             answers, in_token, out_tokens = QA(question, d['document_text'])
#             answers_str = ''.join(answers)
#             if 'null' in answers_str.lower() or len(answers_str) > 200:
#                 print('invalid:', qid)
#                 continue
#             print('valid qid', qid)
#             question_id = qid 
#             break 
#         selected_q = questions[question_id]
#         o['id'] = d['paper_id']
#         o['title'] = d['title']
#         o['question'] = selected_q
#         o['text'] = d['document_text']
#         print(i, o['title'], question_id, selected_q)
#         paper_data.append(o)
#         write_json(paper_data, '/Users/yiminglin/Documents/Codebase/doc-provenance/data/qasper_sample_papers.json')
#         i += 1
#         if i > 501:
#             break

def digest_paper_dataset(file_path):
    paper_data = []
    with open(file_path, "r", encoding="utf-8") as file:
        data = json.load(file)  # Load entire JSON file
    for d in data:
        o = {}
        o['id'] = d['id']
        o['title'] = d['title']
        o['text'] = d['text']
        o['question'] = d['question']
        #print(o)
        paper_data.append(o)
        #break 
        
    return paper_data

def digest_hotpotQA_dataset_raw(file_path):
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
        hotpot['instruction'] = entry['instruction'] 
        hotpot['answer'] = entry['answer']
        hotpot['document_name'] = entry['document_name']
        hotpot['context'] = context
        hotpots.append(hotpot)
    return hotpots 

def digest_hotpotQA_dataset(file_path):
    with open(file_path, "r", encoding="utf-8") as file:
        hotpots = json.load(file)  # Load entire JSON file
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
    questions.append(('Who are the authors of this paper?','Return only the author names. Do not add explanations.'))
    questions.append(('In which conference was this paper published?', 'Return only the conference name. Do not add explanations.'))

    return questions

def paper_questions():
    questions = []
    questions.append('In what year was this paper published?')
    questions.append('Who are the authors of this paper?')
    questions.append('In which conference was this paper published?')
    


if __name__ == "__main__":
    digest_paper_dataset('/Users/yiminglin/Documents/Codebase/doc-provenance/data/qasper_sample_papers.json')
    

        

