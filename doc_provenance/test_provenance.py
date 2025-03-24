import provenance
import data_digestion, base_strategies
import os 
import concurrent.futures
current_file_directory = os.path.dirname(os.path.abspath(__file__))
parent_directory = os.path.dirname(current_file_directory)

# sufficient_provenance_strategy_pool = ['raw','embedding_sufficient_top_down','embedding_sufficient_bottem_up','divide_and_conquer_sufficient', 'LLM_score_sufficient_top_down', 'LLM_score_sufficient_bottem_up']
sufficient_provenance_strategy_pool = ['embedding_sufficient_top_down']
minimal_provenance_strategy_pool = ['null']

import json
def read_json(path):
    with open(path, "r", encoding="utf-8") as file:
        data = json.load(file)
    return data

def hotpot_pipeline():
    data_path = parent_directory + '/data/hotpotQA_fullwiki.json'
    folder_path = parent_directory + '/out/hotpotQA'
    hotpot_objects = data_digestion.digest_hotpotQA_dataset(data_path)
    #print(len(hotpot_objects))

    num_of_case = 5

    i = -1
    for e in hotpot_objects:
        i += 1
        q = e['question']
        instruction = e['instruction']
        question = (q, instruction)
        text = e['context']
        title = e['document_name']
        #print(question)

        for sufficient_provenance_strategy in sufficient_provenance_strategy_pool:
            for minimal_provenance_strategy in minimal_provenance_strategy_pool:
                strategy = sufficient_provenance_strategy + '_' + minimal_provenance_strategy
                #print(strategy)
                if sufficient_provenance_strategy != 'divide_and_conquer_sufficient':
                    continue
                if minimal_provenance_strategy != 'null':
                    continue

                path = folder_path + '/results/' + 'hotpot' + '_q' + str(i) + '_' + strategy + '.json'
                print(path)
                if not os.path.exists(folder_path + '/results'):
                    os.makedirs(folder_path + '/results')
                # if os.path.isfile(path):
                #     continue
                embedding_path = folder_path + '/embeddings/' + 'hotpot' + '_q' + str(i) + '_embeddings.npy'
                provenance.logger(text, question, title, path, sufficient_provenance_strategy, minimal_provenance_strategy, metric = 'string', embedding_path=embedding_path)
        if i > num_of_case:
            break

def paper_pipeline():
    data_path = parent_directory + '/data/papers.json'
    folder_path = parent_directory + '/out/papers'
    paper_objects = data_digestion.digest_paper_dataset(data_path)

    doc_num = 101

    print(len(paper_objects))

    c = 0
    for p_id in range(len(paper_objects)):
        paper = paper_objects[p_id]
        # if os.path.isfile(path):
        #     continue
        text = paper['text']
        title = paper['title']
        if len(text) == 0:
            continue
        print(c)
        c += 1
        embedding_path = folder_path + '/embeddings/' + title + '_embeddings.npy'
        sentences = base_strategies.extract_sentences_from_pdf(text)
        merged_setences = base_strategies.group_sentences(sentences, k=5)
        print(len(sentences), len(merged_setences))
        for s in merged_setences:
            print('***',s)
        break

def get_sufficient_result(sufficient_path):
    if os.path.isfile(sufficient_path):
        result = read_json(sufficient_path)
        if 'time' in result and 'tokens' in result and 'provenance_ids' in result and 'eval_time' in result:
            return result['time'], result['tokens'], result['provenance_ids'], result['eval_time']
    return -1,(-1,-1), [-1], -1

def write_json_to_file(filename, data):
    with open(filename, "w", encoding="utf-8") as file:
        json.dump(data, file, indent=4, ensure_ascii=False)

def nl_dev_pipeline():
    #nl_dev
    data_path = parent_directory + '/data/natural-questions_nq-dev-full.json'
    embedding_folder = parent_directory + '/out/nl_dev'
    folder_path = '/Users/yiminglin/Documents/Codebase/doc_provenance_results/eval' + '/nl_dev/results/'

    objects = read_json(data_path)
    instruction = 'Only return answers. Do not add explanations. If answers are not found in the given context, return NULL. Context: '

    num_case = 500
    
    for sufficient_provenance_strategy in sufficient_provenance_strategy_pool:
        for minimal_provenance_strategy in minimal_provenance_strategy_pool:
            strategy = sufficient_provenance_strategy + '_' + minimal_provenance_strategy
            
            # if sufficient_provenance_strategy != 'LLM_score_sufficient_bottem_up':
            #     continue
            # if minimal_provenance_strategy != 'null':
            #     continue

            i = 0
            #with concurrent.futures.ProcessPoolExecutor(max_workers=1) as executor:
            for o in objects:
                embedding_path = embedding_folder + '/embeddings/' + 'nl_' + str(i) + '_embeddings.npy'
                
                print(strategy)
                print(i+1)

                text = o['text']
                q = o['question']
                question = (q, instruction)
                title = o['id']
                print(question)
                i += 1

                if i == 73:
                    continue
                # if i == 82 or i == 72 or i == 89:
                #     continue

                # if sufficient_provenance_strategy == 'divide_and_conquer_sufficient' and minimal_provenance_strategy == 'sequential_greedy':
                #     if i == 82 or i == 72 or i == 89:
                #         continue
                # if sufficient_provenance_strategy == 'divide_and_conquer_sufficient' and minimal_provenance_strategy == 'exponential_greedy':
                #     if i == 99:
                #         continue
                # if sufficient_provenance_strategy == 'LLM_score_sufficient_top_down' and minimal_provenance_strategy == 'sequential_greedy':
                #     if i == 15 or i==22 or i==25:
                #         continue
                result_path = folder_path + str(i) + '_' + str(title) + '_'  + strategy + '.json'
                sufficient_path = folder_path + str(i) + '_' + str(title) + '_'  + sufficient_provenance_strategy + '_null' + '.json'
                sufficient_time, sufficient_tokens, sufficient_provenance_ids, sufficient_eval_latency =  get_sufficient_result(sufficient_path)

                # if i == 74 or i == 83 or i==85:
                #     #print('time out:',i)
                #     logs = {}
                #     logs['status'] = 'out of time'
                #     write_json_to_file(result_path, logs)
                #     continue

                print('result_path:', result_path)
                print('sufficient_path:', sufficient_path)
                print('embedding_path:',embedding_path)

                print('sufficient_time:', sufficient_time)
                #sufficient_time = -1
                status = 'null'
                if os.path.isfile(result_path):
                    result = read_json(result_path)
                    if 'status' in result:
                        status = result['status']
                    else:
                        status = 'computed'
                
                if status == 'computed':
                    continue
                if(i >= 20):
                    break
                
                provenance.logger(text, question, title, result_path, sufficient_provenance_strategy, minimal_provenance_strategy, metric = 'LLM', embedding_path=embedding_path, sufficient_time = sufficient_time, sufficient_tokens = sufficient_tokens, sufficient_provenance_ids = sufficient_provenance_ids, sufficient_eval_latency = sufficient_eval_latency)
                        

if __name__ == "__main__":
    nl_dev_pipeline()