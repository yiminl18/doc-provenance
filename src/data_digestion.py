import json, os

current_file_directory = os.path.dirname(os.path.abspath(__file__))
parent_directory = os.path.dirname(current_file_directory)

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

def sample_paper_questions():
    questions = []
    questions.append(('In what year was this paper published?','Return only a number. Do not add explanations.'))
    questions.append(('Who are the authors of this paper?','Return only a list of strings, seperated by |'))
    questions.append(('In which conference was this paper published?', 'Return only the conference name. '))

    return questions
    


if __name__ == "__main__":
    paper_data_path = parent_directory + '/data/papers.json'
    paper_data = digest_paper_dataset(paper_data_path)
    for i in range(3):
        o = paper_data[i]
        print(o['title'])
        #print(o['text'][:10])
        for i in range(3):
            print(o['question_answer'][i])
        

